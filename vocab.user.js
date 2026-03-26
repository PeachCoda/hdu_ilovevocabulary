// ==UserScript==
// @name         HDU我爱记单词
// @namespace    https://github.com/PeachCoda/hdu_ilovevocabulary
// @version      1.0.0
// @description  包含完整的可视化控制面板，支持题库导入、AI兜底配置、中英双向查词。
// @author       Coda
// @license      MIT
// @match        https://skl.hdu.edu.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/PeachCoda/hdu_ilovevocabulary/main/vocab.user.js
// @downloadURL  https://raw.githubusercontent.com/PeachCoda/hdu_ilovevocabulary/main/vocab.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 核心状态 ====================
    const CONFIG = {
        autoClick: true,
        clickDelay: 1200,
        waitNextQuestion: 1500,
    };

    let questionBank = GM_getValue('questionBank', {});
    let lastQuestion = "";
    let isProcessing = false;
    let questionCount = 0;

    // ==================== AI 配置存取 ====================
    function getAIConfig() {
        return {
            enabled: GM_getValue('ai_enabled', false),
            base_url: GM_getValue('ai_base_url', 'https://api.deepseek.com/v1'),
            token: GM_getValue('ai_token', ''),
            model: GM_getValue('ai_model', 'deepseek-chat'),
            temperature: GM_getValue('ai_temperature', 0.1),
            timeout: GM_getValue('ai_timeout', 15000),
            retries: GM_getValue('ai_retries', 2)
        };
    }

    function saveAIConfig(config) {
        GM_setValue('ai_enabled', config.enabled);
        GM_setValue('ai_base_url', config.base_url);
        GM_setValue('ai_token', config.token);
        GM_setValue('ai_model', config.model);
        GM_setValue('ai_temperature', config.temperature);
        GM_setValue('ai_timeout', config.timeout);
        GM_setValue('ai_retries', config.retries);
    }

    function saveQuestionBank() {
        GM_setValue('questionBank', questionBank);
    }

    // ==================== 核心逻辑引擎 ====================

    // 文本清洗：去除首尾空格、前面的标号以及末尾的句号
    function cleanText(text) {
        if (!text) return "";
        return text.replace(/^[A-D][\s:.]*/i, '').replace(/[\s.]+$/, '').replace(/\s+/g, '').toLowerCase().trim();
    }

    // 从新版 DOM 提取题目和选项
    function extractQuestion() {
        try {
            const titleNode = document.querySelector('.q-title');
            if (!titleNode) return null;
            const rawQuestion = titleNode.textContent;
            const question = cleanText(rawQuestion);

            const optionNodes = document.querySelectorAll('.option-text');
            if (optionNodes.length < 4) return null;

            const rawOptions = Array.from(optionNodes).slice(0, 4).map(el => el.textContent);
            const options = rawOptions.map(opt => cleanText(opt));

            return { question, options, rawQuestion, rawOptions };
        } catch (e) {
            return null;
        }
    }

    // 双向匹配核心引擎
    function findAnswerInBank(question, options) {
        // 1. 正向匹配 (英 -> 中)
        const expectedEn = questionBank[question] || questionBank[question.toLowerCase()];
        if (expectedEn) {
            const meanings = expectedEn.split(/\s*[|｜]\s*/).map(cleanText);
            for (let i = 0; i < options.length; i++) {
                if (meanings.includes(options[i])) return i;
            }
        }

        // 2. 反向匹配 (中 -> 英)
        for (let i = 0; i < options.length; i++) {
            const optText = options[i];
            for (const [key, value] of Object.entries(questionBank)) {
                if (cleanText(key) === optText) {
                    const meanings = value.split(/\s*[|｜]\s*/).map(cleanText);
                    if (meanings.includes(question) || meanings.some(m => question.includes(m) || m.includes(question))) {
                        console.log(`[HDU神盾] 反向查词成功: ${key} -> ${value}`);
                        return i;
                    }
                }
            }
        }
        return -1;
    }

    // AI 辅助答题
    async function aiChooseAnswer(rawQuestion, rawOptions) {
        const aiConf = getAIConfig();
        if (!aiConf.enabled || !aiConf.base_url || !aiConf.token) {
            console.warn(`[HDU神盾] AI未启用或密钥为空！`);
            return -1;
        }

        const prompt = `题目：${rawQuestion}\n选项：\nA. ${rawOptions[0]}\nB. ${rawOptions[1]}\nC. ${rawOptions[2]}\nD. ${rawOptions[3]}\n请直接输出A或B或C或D，不要任何解释。`;

        const payload = {
            model: aiConf.model,
            messages: [
                { role: "system", content: "你是一个只能输出单个字母的无情做题机器。根据题目选出正确答案对应的字母。" },
                { role: "user", content: prompt }
            ],
            temperature: aiConf.temperature,
            max_tokens: 5
        };

        for (let attempt = 1; attempt <= aiConf.retries; attempt++) {
            try {
                console.log(`[HDU神盾] AI 脑力激荡中... (尝试 ${attempt}/${aiConf.retries})`);
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: `${aiConf.base_url.replace(/\/$/, '')}/chat/completions`,
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${aiConf.token}`
                        },
                        data: JSON.stringify(payload),
                        timeout: aiConf.timeout,
                        onload: resolve,
                        onerror: reject
                    });
                });

                if (response.status === 200) {
                    const data = JSON.parse(response.responseText);
                    const answer = data.choices[0].message.content.trim().toUpperCase();
                    const match = answer.match(/[A-D]/);
                    if (match) {
                        const index = match[0].charCodeAt(0) - 65;
                        console.log(`[HDU神盾] AI 决定选: ${match[0]}`);
                        return index;
                    }
                }
            } catch (e) {
                console.warn(`[HDU神盾] AI 请求异常:`, e);
            }
        }
        return -1;
    }

    // 强力点击
    function clickAnswer(index) {
        const itemNodes = document.querySelectorAll('.option-item');
        if (itemNodes.length > index) {
            const target = itemNodes[index];
            target.click();
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            console.log(`[HDU神盾] 已暴力点击选项 ${String.fromCharCode(65 + index)}`);
            return true;
        }
        return false;
    }

    // 主线执行流程
    async function processLoop() {
        if (isProcessing) return;
        const qData = extractQuestion();

        if (!qData || qData.question === lastQuestion) return;

        isProcessing = true;
        lastQuestion = qData.question;
        questionCount++;

        document.getElementById('question-count').textContent = questionCount;
        console.log(`\n--- 第 ${questionCount} 题: [${qData.rawQuestion}] ---`);

        let ansIndex = findAnswerInBank(qData.question, qData.options);

        if (ansIndex !== -1) {
            console.log(`[HDU神盾] 题库秒杀！`);
        } else {
            console.log(`[HDU神盾] 题库未命中，摇 AI 帮忙...`);
            ansIndex = await aiChooseAnswer(qData.rawQuestion, qData.options);
        }

        if (ansIndex !== -1 && CONFIG.autoClick) {
            setTimeout(() => {
                clickAnswer(ansIndex);
                isProcessing = false;
            }, CONFIG.clickDelay);
        } else {
            console.warn(`[HDU神盾] 彻底蒙圈，请人工介入！`);
            isProcessing = false;
        }
    }

    // ==================== UI 控制面板 ====================
    function createControlPanel() {
        const aiConfig = getAIConfig();
        const panel = document.createElement('div');
        panel.id = 'hdu-assistant-panel';
        panel.innerHTML = `
            <div id="hdu-panel-container" style="position: fixed; top: 10px; right: 10px; z-index: 10000;
                        background: rgba(255,255,255,0.95); border: 2px solid #1989fa;
                        border-radius: 8px; padding: 0; box-shadow: 0 2px 12px rgba(0,0,0,0.2);
                        font-family: Arial, sans-serif; min-width: 220px; max-width: 350px;
                        max-height: 90vh; overflow: hidden;">
                <div id="hdu-panel-header" style="padding: 10px 15px; background: #1989fa; color: white;
                                                   border-radius: 6px 6px 0 0; display: flex; justify-content: space-between;
                                                   align-items: center; cursor: move; user-select: none;">
                    <div style="font-weight: bold; font-size: 14px;">🛡️ HDU 真神版</div>
                    <button id="toggle-panel" style="background: transparent; border: none; color: white; cursor: pointer; font-size: 16px;">−</button>
                </div>
                <div id="hdu-panel-content" style="padding: 15px; overflow-y: auto; max-height: calc(90vh - 50px);">
                    <div style="font-size: 12px; margin-bottom: 5px;">题库数量: <span id="bank-count" style="font-weight:bold; color:#1989fa;">${Object.keys(questionBank).length}</span></div>
                    <div style="font-size: 12px; margin-bottom: 5px;">已答题数: <span id="question-count" style="font-weight:bold;">0</span></div>
                    <div style="font-size: 12px; margin-bottom: 10px;">AI 状态: <span id="ai-status" style="font-weight:bold; color: ${aiConfig.enabled ? 'green' : 'red'}">${aiConfig.enabled ? '✓ 已启用' : '✗ 未启用'}</span></div>

                    <button id="toggle-auto" style="width: 100%; padding: 8px; margin-bottom: 5px; background: #1989fa; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">暂停自动答题</button>
                    <button id="import-bank" style="width: 100%; padding: 8px; margin-bottom: 10px; background: #ff976a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">📂 导入题库 (JSON)</button>

                    <div style="border-top: 1px solid #eee; padding-top: 10px;">
                        <div style="font-weight: bold; font-size: 12px; margin-bottom: 5px;">🤖 AI 配置</div>
                        <label style="display: block; font-size: 12px; margin-bottom: 5px;"><input type="checkbox" id="ai-enabled" ${aiConfig.enabled ? 'checked' : ''}> 启用 AI 兜底</label>
                        <input type="text" id="ai-base-url" placeholder="API 地址 (例如 https://api.deepseek.com/v1)" value="${aiConfig.base_url}" style="width: 100%; padding: 5px; margin-bottom: 5px; font-size: 11px; box-sizing: border-box;">
                        <input type="password" id="ai-token" placeholder="填写你的 API 密钥 (sk-...)" value="${aiConfig.token}" style="width: 100%; padding: 5px; margin-bottom: 5px; font-size: 11px; box-sizing: border-box;">
                        <input type="text" id="ai-model" placeholder="模型名称 (如 deepseek-chat)" value="${aiConfig.model}" style="width: 100%; padding: 5px; margin-bottom: 10px; font-size: 11px; box-sizing: border-box;">
                        <button id="save-ai-config" style="width: 100%; padding: 8px; background: #07c160; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">💾 保存配置</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定拖拽
        const container = document.getElementById('hdu-panel-container');
        const header = document.getElementById('hdu-panel-header');
        let isDragging = false, currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;

        header.addEventListener('mousedown', e => {
            initialX = e.clientX - xOffset; initialY = e.clientY - yOffset;
            isDragging = true;
        });
        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            e.preventDefault();
            currentX = e.clientX - initialX; currentY = e.clientY - initialY;
            xOffset = currentX; yOffset = currentY;
            container.style.transform = `translate(${currentX}px, ${currentY}px)`;
        });
        document.addEventListener('mouseup', () => isDragging = false);

        // 绑定最小化
        document.getElementById('toggle-panel').addEventListener('click', () => {
            const content = document.getElementById('hdu-panel-content');
            if (content.style.display === 'none') {
                content.style.display = 'block';
                document.getElementById('toggle-panel').textContent = '−';
            } else {
                content.style.display = 'none';
                document.getElementById('toggle-panel').textContent = '+';
            }
        });

        // 绑定按钮事件
        document.getElementById('toggle-auto').addEventListener('click', (e) => {
            CONFIG.autoClick = !CONFIG.autoClick;
            e.target.textContent = CONFIG.autoClick ? '暂停自动答题' : '开始自动答题';
            e.target.style.background = CONFIG.autoClick ? '#1989fa' : '#999';
        });

        document.getElementById('import-bank').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const imported = JSON.parse(event.target.result);
                        questionBank = { ...questionBank, ...imported };
                        saveQuestionBank();
                        document.getElementById('bank-count').textContent = Object.keys(questionBank).length;
                        alert(`成功导入题库！当前共 ${Object.keys(questionBank).length} 题。`);
                    } catch (err) { alert('导入失败，请确保是标准的 JSON 文件！'); }
                };
                reader.readAsText(file);
            };
            input.click();
        });

        document.getElementById('save-ai-config').addEventListener('click', () => {
            const config = {
                enabled: document.getElementById('ai-enabled').checked,
                base_url: document.getElementById('ai-base-url').value.trim(),
                token: document.getElementById('ai-token').value.trim(),
                model: document.getElementById('ai-model').value.trim(),
                temperature: 0.1, timeout: 15000, retries: 2
            };
            saveAIConfig(config);
            document.getElementById('ai-status').style.color = config.enabled ? 'green' : 'red';
            document.getElementById('ai-status').textContent = config.enabled ? '✓ 已启用' : '✗ 未启用';
            alert('AI 配置保存成功！');
        });
    }

    // ==================== 启动器 ====================
    function startEngine() {
        console.log('[HDU神盾] UI 和核心引擎均已启动...');
        createControlPanel();

        const targetNode = document.querySelector('#app') || document.body;
        const observer = new MutationObserver(() => {
            if (window.location.href.includes('english')) {
                setTimeout(processLoop, 500);
            }
        });
        observer.observe(targetNode, { childList: true, subtree: true, characterData: true });

        setTimeout(processLoop, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
})();
