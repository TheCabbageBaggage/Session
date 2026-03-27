'use strict';
/* Session – Main JS (Bootstrap is loaded separately via CDN) */

// Auto-dismiss alerts after 5 seconds
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.alert-dismissible[data-auto-dismiss]').forEach((el) => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(el);
      bsAlert.close();
    }, 5000);
  });
});
