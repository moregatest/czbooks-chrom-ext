// 獲取當前頁面的小說id
async function getCurrentNovelId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = tab.url.match(/\/n\/(([\w-]+))/);
  return match ? match[1] : null;
}

// 更新UI狀態
function updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, state) {
  if (state.downloading) {
    downloadBtn.disabled = true;
    progress.style.display = 'block';
    if (state.progressValue !== undefined) {
      progressBar.value = state.progressValue;
      progressText.textContent = `${state.progressValue}%`;
    }
    if (state.statusText) {
      status.textContent = state.statusText;
      status.className = state.statusClass || '';
    }
    if (state.chapterInfo) {
      chapterInfo.textContent = state.chapterInfo;
    }
  } else {
    downloadBtn.disabled = false;
    progress.style.display = 'none';
    if (state.statusText) {
      status.textContent = state.statusText;
      status.className = state.statusClass || '';
    } else {
      status.textContent = '';
      status.className = '';
    }
  }
  
  saveBtn.disabled = !state.enableSave;
}

// 儲存設定到 Chrome Storage
async function saveSettings(batchSize) {
  await chrome.storage.local.set({
    'czbooks_settings': {
      batchSize: batchSize,
      lastUpdate: Date.now()
    }
  });
  return true;
}

// 從 Chrome Storage 讀取設定
async function getSettings() {
  const result = await chrome.storage.local.get('czbooks_settings');
  return result.czbooks_settings || { batchSize: 100 };
}

document.addEventListener('DOMContentLoaded', async function() {
  const downloadBtn = document.getElementById('downloadBtn');
  const saveBtn = document.getElementById('saveBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const batchSizeInput = document.getElementById('batchSize');
  const status = document.getElementById('status');
  const progress = document.querySelector('.progress');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const chapterInfo = document.getElementById('chapterInfo');
  
  // 載入設定
  const settings = await getSettings();
  batchSizeInput.value = settings.batchSize || 100;

  // 獲取當前小說的下載狀態
  const novelId = await getCurrentNovelId();
  if (novelId) {
    const result = await chrome.storage.local.get(`novel_${novelId}`);
    const savedProgress = result[`novel_${novelId}`];
    if (savedProgress) {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: false,
        progressValue: 0,
        statusText: '已有下載進度，點擊開始繼續下載',
        enableSave: true
      });
    }
  }

  downloadBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url.startsWith('https://czbooks.net/n/')) {
        throw new Error('請在 czbooks.net 的小說頁面使用此擴充功能');
      }

      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: true,
        statusText: '正在準備下載...',
        enableSave: false
      });

      // 取得當前設定的批次大小
      const settings = await getSettings();
      
      // 發送消息給 content script 開始下載，並傳遞批次大小設定
      chrome.tabs.sendMessage(tab.id, { 
        action: 'startDownload',
        batchSize: settings.batchSize || 100
      });
    } catch (error) {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: false,
        statusText: error.message,
        statusClass: 'error',
        enableSave: false
      });
    }
  });

  saveBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 顯示正在保存的UI狀態
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: true,
        statusText: '正在儲存當前進度...',
        statusClass: '',
        enableSave: false
      });
      
      chrome.tabs.sendMessage(tab.id, { action: 'saveProgress' });
    } catch (error) {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: false,
        statusText: error.message,
        statusClass: 'error',
        enableSave: false
      });
    }
  });
  
  // 儲存設定按鈕事件
  saveSettingsBtn.addEventListener('click', async () => {
    try {
      const batchSize = parseInt(batchSizeInput.value, 10);
      
      // 驗證輸入值
      if (isNaN(batchSize) || batchSize < 10 || batchSize > 500) {
        throw new Error('每批章節數必須在 10 到 500 之間');
      }
      
      // 儲存設定
      await saveSettings(batchSize);
      
      // 更新 UI 狀態
      status.textContent = '設定已儲存';
      status.className = 'success';
      
      // 3 秒後清除狀態訊息
      setTimeout(() => {
        if (status.textContent === '設定已儲存') {
          status.textContent = '';
          status.className = '';
        }
      }, 3000);
    } catch (error) {
      status.textContent = error.message;
      status.className = 'error';
    }
  });

  // 監聽來自 background script 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'progress' && message.novelId === novelId) {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: true,
        progressValue: message.value,
        enableSave: true,
        chapterInfo: `${message.current}/${message.total}`
      });
    } else if (message.type === 'status' && message.novelId === novelId) {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: true,
        statusText: message.text,
        statusClass: message.class,
        enableSave: true
      });
    } else if (message.type === 'complete' && message.novelId === novelId) {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: false,
        statusText: '下載完成！',
        statusClass: 'success',
        enableSave: false
      });
    } else if (message.type === 'partial_complete' && message.novelId === novelId) {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: true,
        statusText: `已下載部分 ${message.batchNumber}，繼續下載中...`,
        statusClass: 'success',
        enableSave: true
      });
      
      // 顯示部分下載成功訊息 3 秒後恢復下載狀態
      setTimeout(() => {
        updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
          downloading: true,
          statusText: '下載中...',
          enableSave: true
        });
      }, 3000);
    } else if (message.type === 'error') {
      updateUIState(downloadBtn, saveBtn, status, progress, progressBar, progressText, chapterInfo, {
        downloading: false,
        statusText: message.error,
        statusClass: 'error',
        enableSave: true
      });
    }
  });
});
