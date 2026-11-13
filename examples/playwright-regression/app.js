(function () {
  'use strict';
  const form = document.querySelector('#task-form');
  const input = document.querySelector('#task-name');
  const error = document.querySelector('#task-error');
  const status = document.querySelector('[role="status"]');
  const list = document.querySelector('#task-list');
  const empty = document.querySelector('#empty-state');
  let tasks = [];
  let filter = 'all';

  function render() {
    const completed = tasks.filter(task => task.completed).length;
    document.querySelector('[data-testid="active-count"]').textContent = tasks.length - completed;
    document.querySelector('[data-testid="completed-count"]').textContent = completed;
    document.querySelector('[data-testid="total-count"]').textContent = `共 ${tasks.length} 项`;
    list.replaceChildren();
    const visible = tasks.filter(task => filter === 'all' || (filter === 'completed') === task.completed);
    for (const task of visible) {
      const row = document.createElement('li');
      row.className = `task-row${task.completed ? ' is-completed' : ''}`;
      const label = document.createElement('label');
      label.className = 'task-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.setAttribute('aria-label', `完成 ${task.title}`);
      checkbox.addEventListener('change', () => {
        tasks = tasks.map(item => item.id === task.id ? TaskModel.toggleTask(item) : item);
        render();
        const replacement = list.querySelector(`[data-task-id="${task.id}"] input`);
        if (replacement) replacement.focus();
        else document.querySelector(`[data-filter="${filter}"]`).focus();
        status.textContent = task.completed ? '已恢复为待完成' : '任务已完成';
      });
      const title = document.createElement('span');
      title.className = 'task-title';
      title.textContent = task.title;
      label.append(checkbox, title);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-task';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除 ${task.title}`);
      remove.addEventListener('click', () => {
        tasks = tasks.filter(item => item.id !== task.id);
        render();
        input.focus();
        status.textContent = '任务已删除';
      });
      row.dataset.taskId = task.id;
      row.append(label, remove);
      list.append(row);
    }
    empty.hidden = visible.length > 0;
    document.querySelector('#empty-message').textContent = filter === 'completed'
      ? '暂无已完成任务' : filter === 'active' ? '暂无待完成任务' : '暂无任务';
  }

  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    status.textContent = '';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const result = TaskModel.createTask(input.value, globalThis.TASK_APP_MODE);
    if (!result.ok) {
      error.textContent = result.error;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      status.textContent = '';
      return;
    }
    tasks.push(result.task);
    input.value = '';
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    filter = 'all';
    updateFilters();
    render();
    status.textContent = '任务已添加';
    input.focus();
  });

  function updateFilters() {
    document.querySelectorAll('[data-filter]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    });
  }
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      updateFilters();
      render();
    });
  });
  render();
})();
