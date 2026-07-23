// Background service worker
console.log("Zap & Key Extension installed");

chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle_zap") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;

            const url = tabs[0].url;
            if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
                url.startsWith('about:') || url.startsWith('edge://') || url.startsWith('brave://')) {
                console.log('Zap & Key: shortcut ignored on restricted page:', url);
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, { action: "toggleZap" })
                .catch(() => {
                    console.log('Zap & Key: content script not ready on:', url);
                });
        });
    }
});
