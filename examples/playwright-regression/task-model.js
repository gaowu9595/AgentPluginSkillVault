(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TaskModel = api;
})(globalThis, function () {
  'use strict';
  let sequence = 0;

  function createTask(input, mode = 'fixed') {
    if (!['broken', 'fixed'].includes(mode)) throw new Error('Unknown app mode');
    // The broken mode preserves the original defect; fixed is the standalone default.
    const title = mode === 'broken' ? input : input.trim();
    if (!title) return { ok: false, error: '请输入任务名称' };
    return { ok: true, task: { id: `task-${++sequence}`, title, completed: false } };
  }

  function toggleTask(task) {
    return { ...task, completed: !task.completed };
  }

  return { createTask, toggleTask };
});
