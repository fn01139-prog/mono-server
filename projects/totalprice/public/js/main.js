/**
 * projects/totalprice/public/js/main.js
 * 탭 전환 + 각 탭의 최초 진입 시점 초기화(lazy init).
 */
(function () {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    gold: document.getElementById('goldPanel'),
    stocks: document.getElementById('stocksPanel'),
    alerts: document.getElementById('alertsPanel'),
  };

  function activate(tab) {
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle('active', key === tab));
    if (tab === 'gold') window.initGoldTab();
    if (tab === 'stocks') window.initStocksTab();
    if (tab === 'alerts') window.initAlertsTab();
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
  });

  activate('gold');
})();
