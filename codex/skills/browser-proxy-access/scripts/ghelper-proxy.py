import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


KNOWN_GHELPER_IDS = {
    "nonmafimegllfoonjgplbabhmgfanaka",
    "cieikaeocafmceoapfogpffaalkncpkc",
    "eoboojokdmamahfilfmamjjkcmkmddgk",
}

COMMON_LOCAL_PROXIES = [
    ("http", "127.0.0.1:7890"),
    ("socks5h", "127.0.0.1:7890"),
    ("http", "127.0.0.1:7897"),
    ("socks5h", "127.0.0.1:7897"),
    ("http", "127.0.0.1:10809"),
    ("socks5h", "127.0.0.1:10808"),
    ("http", "127.0.0.1:1087"),
    ("socks5h", "127.0.0.1:1080"),
]

BROWSER_BASES = {
    "Chrome": ("Google", "Chrome"),
    "Edge": ("Microsoft", "Edge"),
}


def browser_user_data_root(browser):
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    vendor, name = BROWSER_BASES[browser]
    return local / vendor / name / "User Data"


def is_browser_profile(path):
    if not path.is_dir():
        return False
    return (path / "Preferences").exists() or (path / "Local Extension Settings").exists()


def browser_profiles(browser):
    base = browser_user_data_root(browser)
    if not base.exists():
        return []

    preferred = []
    for name in ("Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4"):
        path = base / name
        if is_browser_profile(path):
            preferred.append(path)

    seen = {path.name for path in preferred}
    others = [
        path
        for path in base.iterdir()
        if path.name not in seen and is_browser_profile(path)
    ]
    return preferred + sorted(others, key=lambda item: item.name.lower())


def extension_name(browser, profile_name, extension_id):
    base = browser_user_data_root(browser) / profile_name / "Extensions" / extension_id
    if not base.exists():
        return ""

    manifests = sorted(base.glob("*/manifest.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    for manifest in manifests:
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            return str(data.get("name") or "")
        except Exception:
            continue
    return ""


def storage_roots(profile, known_only=False):
    roots = []
    browsers = ["Chrome", "Edge"] if profile == "All" else [profile]

    for browser in browsers:
        for browser_profile in browser_profiles(browser):
            settings_dir = browser_profile / "Local Extension Settings"
            if not settings_dir.exists():
                continue

            extension_dirs = []
            if known_only:
                extension_dirs = [settings_dir / extension_id for extension_id in KNOWN_GHELPER_IDS]
            else:
                extension_dirs = [path for path in settings_dir.iterdir() if path.is_dir()]

            for path in extension_dirs:
                if not path.exists() or not path.is_dir():
                    continue

                roots.append(
                    {
                        "browser": browser,
                        "profile": browser_profile.name,
                        "extension_id": path.name,
                        "extension_name": extension_name(browser, browser_profile.name, path.name),
                        "path": path,
                    }
                )

    def score(root):
        known = 0 if root["extension_id"] in KNOWN_GHELPER_IDS else 1
        try:
            latest = max((fp.stat().st_mtime for fp in root["path"].iterdir() if fp.is_file()), default=0)
        except Exception:
            latest = 0
        return (known, -latest, root["browser"], root["profile"], root["extension_id"])

    return sorted(roots, key=score)


def decode_layers(value):
    current = value.encode("ascii", "ignore")
    outputs = []

    for _ in range(2):
        try:
            current = base64.b64decode(current + b"=" * (-len(current) % 4), validate=False)
        except Exception:
            break

        text = current.decode("utf-8", "ignore")
        outputs.append(text)
        current = text.encode("ascii", "ignore")

    return outputs


def extract_pac_scripts(profile, known_only=False):
    data_pattern = re.compile(r'"data"\s*:\s*"([A-Za-z0-9+/=]{200,})"')
    generic_pattern = re.compile(r"[A-Za-z0-9+/=]{400,}")
    scripts = []
    seen = set()

    for root in storage_roots(profile, known_only):
        for file_path in root["path"].iterdir():
            if not file_path.is_file() or file_path.name == "LOCK":
                continue

            try:
                raw = file_path.read_bytes()
            except Exception:
                continue

            text = raw.decode("utf-8", "ignore")
            values = [m.group(1) for m in data_pattern.finditer(text)]
            if not values:
                ascii_text = raw.decode("ascii", "ignore")
                values = [m.group(0) for m in generic_pattern.finditer(ascii_text)]

            for value in values:
                for decoded in decode_layers(value):
                    if not re.search(r"\b(HTTPS|HTTP|SOCKS5|SOCKS)\s+", decoded, re.I):
                        continue

                    key = hashlib.sha256(decoded.encode("utf-8", "ignore")).hexdigest()
                    if key in seen:
                        continue

                    seen.add(key)
                    scripts.append(
                        {
                            "browser": root["browser"],
                            "profile": root["profile"],
                            "extension_id": root["extension_id"],
                            "extension_name": root["extension_name"],
                            "path": str(file_path),
                            "mtime": file_path.stat().st_mtime,
                            "length": len(decoded),
                            "data": decoded,
                        }
                    )

    scripts.sort(key=lambda item: (item["mtime"], item["length"]), reverse=True)
    return scripts


def env_proxy_candidates():
    candidates = []
    seen = set()
    for name in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"):
        value = os.environ.get(name)
        if not value:
            continue
        key = value.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "source": f"env:{name}",
                "browser": "env",
                "profile": "",
                "extension_id": "",
                "extension_name": "",
                "type": "ENV",
                "host_port": proxy_host_port(key),
                "port": proxy_port(key),
                "proxy_url": key,
                "node": masked_node(key),
            }
        )
    return candidates


def netsh_winhttp_proxy_candidates():
    try:
        proc = subprocess.run(
            ["netsh", "winhttp", "show", "proxy"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return []

    text = (proc.stdout or "") + (proc.stderr or "")
    if "Direct access" in text:
        return []

    matches = re.findall(r"(?:https|http)\s*=\s*([^\s;]+)|Proxy Server\(s\)\s*:\s*([^\r\n]+)", text, re.I)
    values = []
    for first, second in matches:
        raw = (first or second or "").strip()
        if not raw:
            continue
        for part in re.split(r"[;\s]+", raw):
            part = part.strip()
            if part and "=" not in part:
                values.append(part)

    return proxy_values_to_candidates(values, "winhttp")


def registry_proxy_candidates():
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
            enabled = winreg.QueryValueEx(key, "ProxyEnable")[0]
            server = winreg.QueryValueEx(key, "ProxyServer")[0]
    except Exception:
        return []

    if not enabled or not server:
        return []

    values = []
    for part in re.split(r"[;\s]+", str(server)):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            part = part.split("=", 1)[1]
        values.append(part)
    return proxy_values_to_candidates(values, "wininet")


def common_local_proxy_candidates():
    candidates = []
    for scheme, host_port in COMMON_LOCAL_PROXIES:
        candidates.append(
            {
                "source": "local-common",
                "browser": "local",
                "profile": "",
                "extension_id": "",
                "extension_name": "",
                "type": scheme.upper(),
                "host_port": host_port,
                "port": int(host_port.rsplit(":", 1)[-1]),
                "proxy_url": f"{scheme}://{host_port}",
                "node": masked_node(f"{scheme}://{host_port}"),
            }
        )
    return candidates


def proxy_values_to_candidates(values, source):
    candidates = []
    seen = set()
    for value in values:
        value = value.strip()
        if not value:
            continue
        if "://" not in value:
            value = "http://" + value
        if value in seen:
            continue
        seen.add(value)
        candidates.append(
            {
                "source": source,
                "browser": source,
                "profile": "",
                "extension_id": "",
                "extension_name": "",
                "type": value.split(":", 1)[0].upper(),
                "host_port": proxy_host_port(value),
                "port": proxy_port(value),
                "proxy_url": value,
                "node": masked_node(value),
            }
        )
    return candidates


def proxy_url(proxy_type, host_port):
    proxy_type = proxy_type.upper()
    if proxy_type == "HTTPS":
        scheme = "https"
    elif proxy_type == "HTTP":
        scheme = "http"
    else:
        scheme = "socks5h"
    return f"{scheme}://{host_port}"


def masked_node(host_port):
    digest = hashlib.sha256(host_port.encode("utf-8")).hexdigest()[:10]
    port = host_port.rsplit(":", 1)[-1]
    return f"node-{digest}:{port}"


def proxy_host_port(value):
    match = re.search(r"(?:(?:https?|socks5h?|socks)://)?(?:[^:@/\s]+:[^@/\s]+@)?([^/@\s]+:\d+)", value, re.I)
    if match:
        return match.group(1)
    return value


def proxy_port(value):
    host_port = proxy_host_port(value)
    try:
        return int(host_port.rsplit(":", 1)[-1])
    except Exception:
        return 0


def extract_candidates(args):
    candidates = []
    seen = set()

    def add_candidate(candidate):
        key = candidate["proxy_url"]
        if key in seen:
            return
        seen.add(key)
        candidate["index"] = len(candidates) + 1
        candidates.append(candidate)

    scripts = []
    if args.use_browser_pac:
        scripts = extract_pac_scripts(args.profile, args.known_extensions_only)

    if args.use_existing_env:
        for candidate in env_proxy_candidates():
            add_candidate(candidate)

    if args.use_system_proxy:
        for candidate in registry_proxy_candidates() + netsh_winhttp_proxy_candidates():
            add_candidate(candidate)

    if args.use_common_local:
        for candidate in common_local_proxy_candidates():
            add_candidate(candidate)

    endpoint_pattern = re.compile(r"\b(HTTPS|HTTP|SOCKS5|SOCKS)\s+([A-Za-z0-9._-]+:\d+)", re.I)

    for script in scripts[: args.script_sample]:
        for proxy_type, host_port in endpoint_pattern.findall(script["data"]):
            proxy_type = proxy_type.upper()
            key = (proxy_type, host_port)
            proxy = proxy_url(proxy_type, host_port)
            if key in seen or proxy in seen:
                continue
            seen.add(key)
            add_candidate(
                {
                    "source": "browser-pac",
                    "browser": script["browser"],
                    "profile": script["profile"],
                    "extension_id": script["extension_id"],
                    "extension_name": script["extension_name"],
                    "type": proxy_type,
                    "host_port": host_port,
                    "port": int(host_port.rsplit(":", 1)[-1]),
                    "proxy_url": proxy,
                    "node": masked_node(host_port),
                }
            )
            if len(candidates) >= args.limit:
                return candidates

    return candidates


def test_candidate(candidate, args):
    started = time.monotonic()
    command = [
        "curl.exe",
        "-sS",
        "-m",
        str(args.timeout),
        "-x",
        candidate["proxy_url"],
        candidate.get("test_url") or args.test_url,
        "-o",
        "NUL",
        "-w",
        "%{http_code} %{errormsg}",
    ]

    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=args.timeout + 2)
        status = (proc.stdout or proc.stderr or "").strip().replace("\n", " ")
        ok = proc.returncode == 0 and re.match(r"^2\d\d", status) is not None
    except Exception as exc:
        status = str(exc)
        ok = False

    elapsed_ms = int((time.monotonic() - started) * 1000)
    result = dict(candidate)
    result.update({"ok": ok, "ms": elapsed_ms, "status": status})
    return result


def print_results(results):
    headers = ["Index", "Source", "Node", "Browser", "Profile", "Ext", "Type", "Port", "Ok", "Ms", "Status"]
    rows = [
        [
            str(item["index"]),
            item.get("source", ""),
            item["node"],
            item["browser"],
            item.get("profile", ""),
            short_ext(item),
            item["type"],
            str(item["port"]),
            str(item["ok"]),
            str(item["ms"]),
            item["status"][:48],
        ]
        for item in results
    ]
    widths = [len(header) for header in headers]
    for row in rows:
        widths = [max(width, len(value)) for width, value in zip(widths, row)]

    print(" ".join(header.ljust(width) for header, width in zip(headers, widths)))
    print(" ".join("-" * width for width in widths))
    for row in rows:
        print(" ".join(value.ljust(width) for value, width in zip(row, widths)))


def short_ext(item):
    extension_id = item.get("extension_id", "")
    name = item.get("extension_name", "")
    prefix = extension_id[:8] if extension_id else ""
    if name:
        return f"{prefix}:{name[:18]}"
    return prefix


def select_candidate(candidates, args):
    if args.index:
        matching = [item for item in candidates if item["index"] == args.index]
        if not matching:
            raise RuntimeError(f"No proxy candidate exists at index {args.index}. Run with --list first.")
        result = test_candidate(matching[0], args)
        if not result["ok"]:
            raise RuntimeError(f"Selected proxy {result['node']} failed: {result['status']}")
        return result

    results = [test_candidate(candidate, args) for candidate in candidates]
    working = [item for item in results if item["ok"]]
    if not working:
        diagnosis = diagnose_failures(results)
        raise RuntimeError("No working proxy candidate was found. " + diagnosis)
    return sorted(working, key=lambda item: item["ms"])[0]


def diagnose_failures(results):
    if not results:
        return "No candidates were discovered."

    connect_403 = [item for item in results if "CONNECT tunnel failed, response 403" in item.get("status", "")]
    browser_pac = [item for item in results if item.get("source") == "browser-pac"]
    browser_403 = [item for item in browser_pac if "CONNECT tunnel failed, response 403" in item.get("status", "")]
    if connect_403 and (
        len(connect_403) >= max(1, len(results) // 2)
        or (browser_pac and len(browser_403) >= max(1, len(browser_pac) // 2))
    ):
        return (
            "Most browser PAC nodes returned CONNECT 403. The browser extension likely adds "
            "authentication or dynamic authorization that this shell helper cannot replay from PAC data alone. "
            "Try --use-existing-env, --use-system-proxy, --use-common-local, or configure a stable local proxy."
        )

    timeouts = [item for item in results if "timed out" in item.get("status", "").lower()]
    if len(timeouts) == len(results):
        return "All candidates timed out. The nodes may be stale or unreachable from this shell session."

    return "Run with --list to inspect candidate statuses."


def apply_env(proxy):
    env = os.environ.copy()
    env["HTTP_PROXY"] = proxy
    env["HTTPS_PROXY"] = proxy
    env["ALL_PROXY"] = proxy
    return env


def parse_args():
    parser = argparse.ArgumentParser(description="Select and use a Ghelper PAC proxy node.")
    parser.add_argument("--profile", choices=["All", "Chrome", "Edge"], default="All")
    parser.add_argument("--use-browser-pac", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--known-extensions-only", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--use-existing-env", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--use-system-proxy", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--use-common-local", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--fastest", action="store_true")
    parser.add_argument("--index", type=int, default=0)
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--script-sample", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=8)
    parser.add_argument("--test-url", default="https://www.google.com/generate_204")
    parser.add_argument("--print-env", action="store_true")
    parser.add_argument("--run-command")
    parser.add_argument("--run", nargs=argparse.REMAINDER)
    return parser.parse_args()


def main():
    args = parse_args()
    candidates = extract_candidates(args)
    if not candidates:
        raise RuntimeError(f"No Ghelper PAC proxy candidates were found for profile '{args.profile}'.")

    if args.list or (not args.fastest and not args.index and not args.print_env and not args.run_command and not args.run):
        results = [test_candidate(candidate, args) for candidate in candidates]
        print_results(results)
        if not args.fastest and not args.index and not args.print_env and not args.run_command and not args.run:
            return 0

    selected = select_candidate(candidates, args)

    if args.print_env:
        print(f"HTTP_PROXY={selected['proxy_url']}")
        print(f"HTTPS_PROXY={selected['proxy_url']}")
        print(f"ALL_PROXY={selected['proxy_url']}")

    if args.run_command:
        print(
            f"Using Ghelper proxy {selected['node']} via {selected['browser']}, "
            f"{selected['type']}:{selected['port']}, {selected['ms']}ms",
            flush=True,
        )
        proc = subprocess.run(args.run_command, shell=True, env=apply_env(selected["proxy_url"]))
        return proc.returncode

    if args.run:
        print(
            f"Using Ghelper proxy {selected['node']} via {selected['browser']}, "
            f"{selected['type']}:{selected['port']}, {selected['ms']}ms",
            flush=True,
        )
        proc = subprocess.run(args.run, env=apply_env(selected["proxy_url"]))
        return proc.returncode

    if not args.print_env:
        print_results([selected])

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
