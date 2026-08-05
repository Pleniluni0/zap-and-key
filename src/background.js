// Background service worker
console.log("Zap & Key Extension installed");

function isRestricted(url) {
    return !url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
        url.startsWith('about:') || url.startsWith('edge://') || url.startsWith('brave://');
}

function sendToActiveTab(action) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        if (isRestricted(tabs[0].url)) {
            console.log('Zap & Key: shortcut ignored on restricted page:', tabs[0].url);
            return;
        }
        chrome.tabs.sendMessage(tabs[0].id, action)
            .catch(() => {
                console.log('Zap & Key: content script not ready on:', tabs[0].url);
            });
    });
}

chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle_zap") {
        sendToActiveTab({ action: "toggleZap" });
    }
});
