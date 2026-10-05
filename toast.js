const Toast = (function () {
  let stack;
  function ensureStack() {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }
  function show(message, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    const icon = '';
    el.innerHTML = '<span>' + message + '</span>';
    ensureStack().appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }
  return {
    success: (msg) => show(msg, 'success'),
    error: (msg) => show(msg, 'error'),
    info: (msg) => show(msg, ''),
  };
})();
