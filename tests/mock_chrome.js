window.chrome = {
    runtime: {
        lastError: null,
        getManifest: () => ({ version: '2.1', manifest_version: 3 }),
    },
    storage: {
        sync: {
            QUOTA_BYTES: 102400,
            QUOTA_BYTES_PER_ITEM: 8192,
            get: (keys, callback) => {
                // Generate 255 rules
                const wordMap = {};
                for (let i = 0; i < 255; i++) {
                    wordMap[`word_${i}`] = {
                        replacement: `replacement_${i}`,
                        caseSensitive: i % 2 === 0,
                        enabled: true
                    };
                }
                // Simulate async
                setTimeout(() => callback({ wordMap }), 0);
            },
            set: (items, callback) => {
                if (callback) callback();
            }
        },
        // Mock for chrome.storage.onChanged — manage.js adds a listener here
        // to detect changes from other tabs. In tests, we just need a no-op.
        onChanged: {
            addListener: () => {}
        }
    }
};
