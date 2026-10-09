// Background service worker

function isRestricted(url) {
    return !url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
        url.startsWith('about:') || url.startsWith('edge://') || url.startsWith('brave://');
}

function sendToActiveTab(action) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        if (isRestricted(tabs[0].url)) {
            return;
        }
        chrome.tabs.sendMessage(tabs[0].id, action)
            .catch(() => {
                // content script no disponible en esta pestaña: se ignora
            });
    });
}

chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle_zap") {
        sendToActiveTab({ action: "toggleZap" });
    }
});
