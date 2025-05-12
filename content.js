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

// 監聽來自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startDownload') {
    startNovelDownload();
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
      downloadedContents, // 改為保存各章節的內容，而不是整個合併後的內容
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
async function startNovelDownload() {
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
        downloadedContents.push(`\n\n${chapter.title}\n\n${chapterContent}`);
        downloadedChapters.push(chapter.url);
        
        // 每下載一章就保存進度
        await saveProgress(novelId, title, downloadedChapters, downloadedContents);
      } catch (error) {
        console.error(`下載章節失敗: ${chapter.title}`, error);
        // 保存當前進度，下次可以從這裡繼續
        await saveProgress(novelId, title, downloadedChapters, downloadedContents);
        throw error;
      }
    }

    // 合併所有章節內容
    const content = `${title}\n\n` + downloadedContents.join('');
    
    console.log('所有章節下載完成，總字數:', content.length);
    
    // 在本地觸發下載
    const success = triggerDownload(content, `${title}.txt`);
    
    if (success) {
      // 下載完成後清除進度
      await chrome.storage.local.remove(`novel_${novelId}`);
      
      // 發送完成訊息
      chrome.runtime.sendMessage({
        type: 'complete',
        novelId: novelId
      });
    } else {
      throw new Error('下載觸發失敗');
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
