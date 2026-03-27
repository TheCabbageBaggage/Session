'use strict';
/* Session – Public Room View JS */

(function () {
  // Display live clock in header
  function updateClock() {
    const el = document.getElementById('current-time');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  updateClock();
  setInterval(updateClock, 1000);
})();
