// 隨機延遲函數
function delay(min, max) {
  const ms = Math.random() * (max - min) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 檢查是否有 Cloudflare 驗證
function hasCloudflareChallenge() {
  return document.querySelector('#challenge-form') !== null;
}

// 獲取小說標題
function getNovelTitle() {
  const titleElement = document.querySelector('span.title');
  if (!titleElement) throw new Error('無法找到小說標題');
  return titleElement.textContent.trim();
}

// 獲取章節列表
function getChapterList() {
  const chapterList = document.querySelector('ul.nav.chapter-list');
  if (!chapterList) throw new Error('無法找到章節列表');
  
  return Array.from(chapterList.querySelectorAll('a')).map(a => ({
    url: a.href,
    title: a.textContent.trim()
  }));
}

// 獲取章節內容
async function getChapterContent(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    
    if (hasCloudflareChallenge()) {
      throw new Error('遇到 Cloudflare 驗證，請稍後再試');
    }

    const content = doc.querySelector('div.content');
    if (!content) throw new Error('無法找到章節內容');
    
    return content.textContent.trim();
  } catch (error) {
    throw new Error(`獲取章節內容失敗: ${error.message}`);
  }
}

// 從 Chrome Storage 讀取設定
async function getSettings() {
  const result = await chrome.storage.local.get('czbooks_settings');
  return result.czbooks_settings || { batchSize: 100 };
}

// 監聽來自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startDownload') {
    // 傳遞批次大小設定
    console.log('收到開始下載消息，批次大小設定為:', message.batchSize);
    startNovelDownload(parseInt(message.batchSize, 10));
  } else if (message.action === 'saveProgress') {
    saveCurrentProgress();
  }
});

// 保存下載進度
async function saveProgress(novelId, title, downloadedChapters, downloadedContents) {
  await chrome.storage.local.set({
    [`novel_${novelId}`]: {
      title,
      downloadedChapters,
      // 只保存最後 50 章的內容，避免超出儲存空間配額
      downloadedContents: downloadedContents.slice(-50),
      lastUpdate: Date.now()
    }
  });
}

// 獲取已保存的進度
async function getProgress(novelId) {
  const result = await chrome.storage.local.get(`novel_${novelId}`);
  return result[`novel_${novelId}`];
}

// 從URL獲取小說ID
function getNovelId() {
  const match = location.pathname.match(/\/n\/([\w-]+)/);
  return match ? match[1] : null;
}

// 創建並觸發下載
function triggerDownload(content, filename) {
  try {
    console.log('在內容腳本中創建下載，內容長度:', content.length);
    
    // 創建一個下載連結
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // 創建並模擬點擊下載鏈接
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    // 清理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    return true;
  } catch (error) {
    console.error('創建下載時出錯:', error);
    return false;
  }
}

// 開始下載小說
async function startNovelDownload(customBatchSize) {
  try {
    if (hasCloudflareChallenge()) {
      throw new Error('請先通過 Cloudflare 驗證');
    }

    const novelId = getNovelId();
    const title = getNovelTitle();
    const chapters = getChapterList();
    
    // 檢查是否有保存的進度
    let savedProgress = await getProgress(novelId);
    let downloadedChapters = savedProgress?.downloadedChapters || [];
    let downloadedContents = savedProgress?.downloadedContents || [];
    let allDownloadedContents = []; // 用於存儲所有已下載的內容
    
    // 如果有已下載的內容，先保存到 allDownloadedContents
    if (savedProgress && savedProgress.downloadedContents) {
      allDownloadedContents = [...savedProgress.downloadedContents];
    }
    
    // 取得批次大小設定
    let BATCH_SIZE = 100; // 預設值
    
    // 輸出自訂批次大小參數
    console.log('自訂批次大小參數:', customBatchSize, '類型:', typeof customBatchSize);
    
    // 如果有自訂的批次大小，則使用它
    if (customBatchSize && !isNaN(customBatchSize)) {
      const batchSize = parseInt(customBatchSize, 10);
      if (batchSize >= 10 && batchSize <= 500) {
        BATCH_SIZE = batchSize;
        console.log('使用自訂批次大小:', BATCH_SIZE);
      }
    } else {
      // 否則嘗試從儲存的設定中讀取
      try {
        const settings = await getSettings();
        if (settings && settings.batchSize) {
          BATCH_SIZE = parseInt(settings.batchSize, 10);
          console.log('使用儲存的批次大小設定:', BATCH_SIZE);
        }
      } catch (error) {
        console.log('無法讀取設定，使用預設值:', error);
      }
    }
    
    console.log(`批次大小設定為: ${BATCH_SIZE} 章`);
    
    let currentBatchCount = 0;
    let currentBatchNumber = Math.floor(downloadedChapters.length / BATCH_SIZE) + 1;
    
    // 更新進度顯示
    const updateProgress = (current, total) => {
      const progress = Math.floor((current / total) * 100);
      chrome.runtime.sendMessage({
        type: 'progress',
        value: progress,
        current: current + 1,
        total: total,
        novelId: novelId
      });
    };
    
    // 觸發部分下載
    const triggerPartialDownload = async () => {
      const partialContent = allDownloadedContents.join('');
      const partialFileName = `${title}_部分${currentBatchNumber}.txt`;
      
      console.log(`觸發部分下載: ${partialFileName}，內容長度: ${partialContent.length}`);
      
      const success = triggerDownload(partialContent, partialFileName);
      
      if (success) {
        // 發送部分完成訊息
        chrome.runtime.sendMessage({
          type: 'partial_complete',
          batchNumber: currentBatchNumber,
          novelId: novelId
        });
        
        // 清空已下載的內容，釋放記憶體
        allDownloadedContents = [];
        downloadedContents = [];
        currentBatchNumber++;
        currentBatchCount = 0;
        
        // 只保留章節 URL 列表，不保留內容
        await chrome.storage.local.set({
          [`novel_${novelId}`]: {
            title,
            downloadedChapters,
            downloadedContents: [],
            lastUpdate: Date.now()
          }
        });
        
        return true;
      } else {
        console.error('部分下載觸發失敗');
        return false;
      }
    };

    // 從上次的進度繼續下載
    for (let i = downloadedChapters.length; i < chapters.length; i++) {
      const chapter = chapters[i];
      
      updateProgress(i, chapters.length);
      
      chrome.runtime.sendMessage({
        type: 'status',
        text: `正在下載: ${chapter.title}`,
        novelId: novelId
      });

      // 加入隨機延遲，避免觸發 Cloudflare 驗證
      await delay(2000, 4000);
      
      try {
        const chapterContent = await getChapterContent(chapter.url);
        const formattedContent = `\n\n${chapter.title}\n\n${chapterContent}`;
        
        downloadedContents.push(formattedContent);
        allDownloadedContents.push(formattedContent);
        downloadedChapters.push(chapter.url);
        currentBatchCount++;
        
        // 每下載一章就保存進度
        await saveProgress(novelId, title, downloadedChapters, downloadedContents);
        
        // 每下載 BATCH_SIZE 章就觸發一次部分下載
        if (currentBatchCount >= BATCH_SIZE) {
          await triggerPartialDownload();
        }
      } catch (error) {
        console.error(`下載章節失敗: ${chapter.title}`, error);
        // 保存當前進度，下次可以從這裡繼續
        await saveProgress(novelId, title, downloadedChapters, downloadedContents);
        throw error;
      }
    }

    // 下載剩餘的章節
    if (allDownloadedContents.length > 0) {
      const finalContent = `${title}\n\n` + allDownloadedContents.join('');
      console.log('最後部分下載完成，總字數:', finalContent.length);
      
      // 在本地觸發下載
      const success = triggerDownload(finalContent, `${title}_最終部分.txt`);
      
      if (success) {
        // 下載完成後清除進度
        await chrome.storage.local.remove(`novel_${novelId}`);
        
        // 發送完成訊息
        chrome.runtime.sendMessage({
          type: 'complete',
          novelId: novelId
        });
      } else {
        throw new Error('最終下載觸發失敗');
      }
    } else {
      // 發送完成訊息
      chrome.runtime.sendMessage({
        type: 'complete',
        novelId: novelId
      });
    }

  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'error',
      error: error.message
    });
  }
}

// 儲存目前進度
async function saveCurrentProgress() {
  try {
    const novelId = getNovelId();
    const savedProgress = await getProgress(novelId);
    
    if (!savedProgress || !savedProgress.downloadedContents || savedProgress.downloadedContents.length === 0) {
      throw new Error('沒有可以儲存的進度');
    }
    
    // 合併已下載的章節內容
    const content = `${savedProgress.title}\n\n` + savedProgress.downloadedContents.join('');
    
    console.log('正在儲存當前進度，已下載章節數:', savedProgress.downloadedChapters.length);

    // 在本地觸發下載
    const success = triggerDownload(content, `${savedProgress.title}_部分.txt`);
    
    if (success) {
      // 發送完成訊息
      chrome.runtime.sendMessage({
        type: 'partial_complete',
        novelId: novelId
      });
    } else {
      throw new Error('進度儲存失敗');
    }

  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'error',
      error: error.message
    });
  }
}
