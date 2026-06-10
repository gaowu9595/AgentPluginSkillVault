# figma-links.md 模板

> 用途：放在 `<项目>/资料/figma-links.md`，触发 design-session:analyze 的 Figma 解析分支。
> 使用方式：复制本模板到项目资料目录，填入实际的 fileKey 和 nodeId。

---

## 使用说明

1. 从 Figma URL 中提取 fileKey：`https://www.figma.com/file/<fileKey>/<fileName>`
2. 从 URL 参数中提取 nodeId：`?node-id=<nodeId>`（格式如 `1234:5678`）
3. 填入下方表格
4. 执行 `/design-session:analyze <项目目录>`，会自动检测并进入 Figma 解析流程

---

## 模板

```markdown
# Figma 交互稿

## 文件信息
- fileKey: [从 Figma URL 提取]
- 项目: [项目名称]

## 页面清单
| 模块 | nodeId | 说明 |
|------|--------|------|
| [模块名1] | [nodeId] | [包含哪些页面/功能] |
| [模块名2] | [nodeId] | [包含哪些页面/功能] |
| [模块名3] | [nodeId] | [包含哪些页面/功能] |

## 解析配置（可选）
- pngScale: 2（默认，1=省空间，2=清晰）
- 需求文档路径: [用于覆盖度分析的需求文档相对路径，可选]
```

---

## 示例

```markdown
# Figma 交互稿

## 文件信息
- fileKey: abc123XYZ456
- 项目: MSSP 海外合作伙伴平台

## 页面清单
| 模块 | nodeId | 说明 |
|------|--------|------|
| 客户管理 | 1234:5678 | 客户列表、详情、创建 |
| 账单管理 | 2345:6789 | 账单列表、详情、还款 |
| 合作伙伴 | 3456:7890 | 伙伴列表、详情、创建 |
| 订阅中心 | 4567:8901 | 产品目录、订阅计划 |

## 解析配置（可选）
- pngScale: 2
- 需求文档路径: 架构设计/系统需求/
```
