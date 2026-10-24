const { MainApp } = await import('./mainApp.js?ver='+window.srcVersion);
const { appPlatform } = await import('./appPlatform.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

var mainApp = new MainApp(appPlatform(), window.importPath, window.wsURL, window.devModeName);

// animation loop
function loopGame(timestamp) {
  mainApp.loopApp(timestamp);
  requestAnimationFrame(loopGame);
} // loopGame

// events processing — the library's input manager gets every browser event;
// it turns them into keyPress/keyRelease/keyMove for the model
window.addEventListener('keydown', (event) => mainApp.inputEventsManager.eventKeyDown(event));
window.addEventListener('keyup', (event) => mainApp.inputEventsManager.eventKeyUp(event));
window.addEventListener('click', (event) => mainApp.inputEventsManager.eventClick(event));
window.addEventListener('contextmenu', (event) => mainApp.inputEventsManager.eventContextMenu(event));
window.addEventListener('mousedown', (event) => mainApp.inputEventsManager.eventMouseDown(event));
window.addEventListener('mouseup', (event) => mainApp.inputEventsManager.eventMouseUp(event));
window.addEventListener('mousemove', (event) => mainApp.inputEventsManager.eventMouseMove(event));
window.addEventListener('wheel', (event) => mainApp.inputEventsManager.eventWheel(event));
window.addEventListener('touchstart', (event) => mainApp.inputEventsManager.eventTouchStart(event));
window.addEventListener('touchend', (event) => mainApp.inputEventsManager.eventTouchEnd(event));
window.addEventListener('touchcancel', (event) => mainApp.inputEventsManager.eventTouchEnd(event));
window.addEventListener('touchmove', (event) => mainApp.inputEventsManager.eventTouchMove(event));
window.addEventListener('blur', (event) => mainApp.inputEventsManager.eventBlurWindow(event));
window.addEventListener('focus', (event) => mainApp.inputEventsManager.eventFocusWindow(event));
window.addEventListener('resize', (event) => mainApp.eventResizeWindow(event));

if (navigator.getGamepads) {
  mainApp.controls.gamepads.supported = true;
}
if (window.matchMedia('(pointer: coarse)').matches) {
  mainApp.controls.touchscreen.supported = true;
}

// prevent accidental back navigation (mouse back button, touchpad swipe, Backspace):
// a sentinel history entry swallows the back action; leaving is confirmed by a dialog.
// The sentinel is pushed on the first user interaction, not at load: Firefox and
// Chrome skip history entries created without user activation (back-trapping
// protection), so a sentinel pushed at load would be bypassed by the back button.
// (The siblings' block, Manic Miner's `main.js`.)
history.replaceState({backGuard: 'base'}, "", location.href);
const armBackGuard = () => {
  if (!history.state || history.state.backGuard !== 'sentinel') {
    history.pushState({backGuard: 'sentinel'}, "", location.href);
  }
};
window.addEventListener('pointerdown', armBackGuard);
window.addEventListener('keydown', armBackGuard);
window.addEventListener('touchstart', armBackGuard);
let leavingApp = false;
// restored from bfcache (browser forward back into the game): module state survived,
// so reset the leave flag; the next interaction re-arms the sentinel via armBackGuard
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    leavingApp = false;
  }
});
window.addEventListener("popstate", (event) => {
  if (leavingApp) {
    history.back(); // keep walking back until we leave the document
    return;
  }
  if (event.state && event.state.backGuard === 'sentinel') {
    return; // initial popstate fired by some engines on page load
  }
  if (window.confirm('Do you really want to leave the game?')) {
    leavingApp = true;
    history.back();
  } else {
    history.pushState({backGuard: 'sentinel'}, "", location.href);
  }
});

// start application
mainApp.eventResizeWindow(null);
requestAnimationFrame(loopGame);

// register service worker when enabled: in production (devMode === false) or in
// dev mode carrying the serviceWorker flag (devMode = {serviceWorker: true});
// plain dev mode (devMode === true) unregisters and bypasses the SW
// (the siblings' block, Manic Miner's `main.js`)
if ('serviceWorker' in navigator) {
  const dm = window.devMode;
  // an explicit disableServiceWorker cookie (toggled from the /config page) forces the SW off
  const swDisabled = Tool.readCookie('disableServiceWorker', false) === 'true';
  const swEnabled = !swDisabled && (!dm || (typeof dm === 'object' && dm.serviceWorker));
  if (swEnabled) {
    // intentionally no auto-reload on controllerchange: the updated SW installs
    // in the background and waits; the new version takes effect via the in-app
    // upgrade or on the next launch after all tabs are closed
    navigator.serviceWorker.register('serviceWorker', { type: 'module' }).catch((error) => console.error('service worker registration failed:', error));
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.unregister()));
  }
}
