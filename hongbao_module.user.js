// ==UserScript==
// @name         鱼排红包板块
// @namespace    https://fishpi.cn
// @license      MIT
// @version      1.1
// @description  右侧新增红包板块，将聊天室红包同步到红包板块，保持实时更新，支持多类型红包
// @author       muli
// @match        https://fishpi.cn/cr
// @icon         https://file.fishpi.cn/2025/11/blob-4d0e46ad.png?imageView2/1/w/48/h/48/interlace/0/q/100
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/mu-xiao-li/yupai-extend-js/main/hongbao_module.user.js
// @updateURL    https://raw.githubusercontent.com/mu-xiao-li/yupai-extend-js/main/hongbao_module.user.js
// ==/UserScript==

// 2026-01-13 新增“是否自动删除已抢光的红包”配置，可配置无效红包是否自动删除

(function() {
    'use strict';

    // 配置
    const CONFIG = {
        maxDisplayCount: 20,          // 最多显示红包数量
        visibleCount: 5,              // 默认可见红包数量
        refreshInterval: 10000,       // 全量扫描间隔（延长到10秒）
        syncInterval: 1000,           // 同步状态间隔
        preserveOriginal: true,       // 保留原清风明月
        position: 'above',           // 红包面板位置: above(上方) / below(下方)
        autoScrollNew: false,         // 关闭自动滚动到新红包（新的在上面）
        monitorNewMessages: true,     // 监听新消息
        newMessageThreshold: 5,        // 每次扫描的新消息数量
        autoDelRedPackets: false        // 是否自动删除已抢光的红包
    };

    // 存储红包数据
    let redPackets = new Map();        // 红包ID -> 红包数据
    let displayOrder = [];             // 显示顺序（红包ID数组）
    let currentDisplayed = new Set();  // 当前显示的红包ID
    let observers = new Map();         // 观察器映射
    let isInitialized = false;
    let originalBreezeMoon = null;     // 原清风明月内容
    let chatObserver = null;           // 聊天室观察器
    let lastProcessedTime = 0;         // 上次处理时间
    let processedMessageIds = new Set(); // 已处理的消息ID

    // 主初始化函数
    function init() {
        if (isInitialized) return;

        console.log('红包同步脚本初始化...');

        // 查找清风明月模块
        const breezeMoonModule = findBreezeMoonModule();
        if (!breezeMoonModule) {
            console.error('未找到清风明月模块，重试中...');
            setTimeout(init, 2000);
            return;
        }

        // 保存原清风明月内容
        saveOriginalContent(breezeMoonModule);

        // 创建红包显示面板
        const redPacketPanel = createRedPacketPanel();

        // 插入到指定位置
        if (CONFIG.position === 'above') {
            // 插入到清风明月模块的上方
            const parent = breezeMoonModule.parentNode;
            if (parent) {
                parent.insertBefore(redPacketPanel, breezeMoonModule);
            }
        } else {
            // 插入到清风明月模块的下方
            if (breezeMoonModule.nextSibling) {
                breezeMoonModule.parentNode.insertBefore(redPacketPanel, breezeMoonModule.nextSibling);
            } else {
                breezeMoonModule.parentNode.appendChild(redPacketPanel);
            }
        }

        // 初始全量扫描
        scanRedPackets();

        // 开始监听聊天室变化
        startChatroomMonitoring();

        // 开始定时任务
        startTimers();

        // 添加事件监听
        addEventListeners();

        isInitialized = true;
        console.log('红包同步脚本初始化完成');
    }

    // 查找清风明月模块
    function findBreezeMoonModule() {
        const selectors = [
            '.module:has(#breezemoonInput)',
            '.module:has(.breezemoon__input)',
            '.breezemoon__input, #breezemoonInput'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                return element.closest('.module');
            }
        }

        return null;
    }

    // 保存原清风明月内容
    function saveOriginalContent(breezeMoonModule) {
        originalBreezeMoon = breezeMoonModule.cloneNode(true);
    }

    // 创建红包面板
    function createRedPacketPanel() {
        const panel = document.createElement('div');
        panel.className = 'module red-packet-module';
        panel.style.cssText = `
            margin-bottom: 15px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
        `;

        // 面板头部
        const header = document.createElement('div');
        header.className = 'module-header form';
        header.style.cssText = `
            background: linear-gradient(135deg, #ff6b6b, #ff8e53);
            color: white;
            border-bottom: 2px solid #ff4757;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
        `;

        const title = document.createElement('div');
        title.style.cssText = 'font-size: 16px; font-weight: bold;';
        title.innerHTML = '  🧧 聊天室红包';

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; align-items: center; gap: 10px;';

        const countBadge = document.createElement('span');
        countBadge.className = 'red-packet-count';
        countBadge.style.cssText = `
            background: rgba(255,255,255,0.2);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
        `;
        countBadge.textContent = '0';

        const expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        expandBtn.style.cssText = `
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        expandBtn.innerHTML = '▼';
        expandBtn.title = '展开/收起';

        controls.appendChild(countBadge);
        controls.appendChild(expandBtn);

        header.appendChild(title);
        header.appendChild(controls);

        // 面板主体
        const body = document.createElement('div');
        body.className = 'module-panel red-packet-body';
        body.style.cssText = `
            max-height: ${CONFIG.visibleCount * 120}px;
            overflow-y: auto;
            transition: max-height 0.3s ease;
            padding: 10px;
        `;

        // 红包列表
        const list = document.createElement('div');
        list.className = 'red-packet-list';
        list.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

        body.appendChild(list);

        panel.appendChild(header);
        panel.appendChild(body);

        // 添加交互事件
        expandBtn.addEventListener('click', function() {
            const isExpanded = body.style.maxHeight === 'none';
            if (isExpanded) {
                body.style.maxHeight = `${CONFIG.visibleCount * 120}px`;
                expandBtn.innerHTML = '▼';
            } else {
                body.style.maxHeight = 'none';
                expandBtn.innerHTML = '▲';
            }
        });

        return panel;
    }

    // 扫描红包（全量）
    function scanRedPackets() {
        console.log('执行全量红包扫描...');
        const chatItems = document.querySelectorAll('#comments .chats__item');
        const newPackets = [];

        chatItems.forEach(item => {
            processChatItem(item, newPackets);
        });

        // 处理新红包
        if (newPackets.length > 0) {
            handleNewPackets(newPackets);
        }

        // 更新显示顺序
        updateDisplayOrder();

        // 更新显示
        updateRedPacketDisplay();
    }

    // 处理单个聊天项
    function processChatItem(item, newPackets) {
        const redPacket = item.querySelector('.hongbao__item');
        if (!redPacket) return;

        const packetId = getRedPacketId(item, redPacket);
        if (!packetId) return;

        // 如果消息已处理过，跳过
        if (processedMessageIds.has(packetId)) return;

        if (!redPackets.has(packetId)) {
            const packetData = {
                id: packetId,
                element: item.cloneNode(true),
                originalElement: item,
                redPacketElement: redPacket,
                originalRedPacket: redPacket,
                time: getMessageTime(item),
                user: getMessageUser(item),
                status: getRedPacketStatus(redPacket),
                lastUpdated: Date.now(),
                observer: null,
                isNew: true
            };
            // 自动删除打开的话 过滤已抢光的红包
            if (CONFIG.autoDelRedPackets && packetData.status == 'empty') {
                return;
            }

            redPackets.set(packetId, packetData);
            processedMessageIds.add(packetId);
            newPackets.push(packetData);

            // 创建观察器来监听红包状态变化
            setupRedPacketObserver(packetData);
        }
    }

    // 处理新红包
    function handleNewPackets(newPackets) {
        // 标记最新红包为新增
        newPackets.forEach(packetData => {
            packetData.isNew = true;
            // 5秒后移除新标记
            setTimeout(() => {
                packetData.isNew = false;
                updateRedPacketItem(packetData.id);
            }, 5000);
        });
    }

    // 扫描最新消息
    function scanLatestMessages() {
        if (!CONFIG.monitorNewMessages) return;

        console.log('扫描最新消息...');
        const chatItems = document.querySelectorAll('#comments .chats__item');
        const newPackets = [];

        // 只扫描最新的N条消息
        const latestItems = Array.from(chatItems).slice(0, CONFIG.newMessageThreshold);

        latestItems.forEach(item => {
            processChatItem(item, newPackets);
        });

        // 如果有新红包，更新显示
        if (newPackets.length > 0) {
            handleNewPackets(newPackets);
            updateDisplayOrder();
            updateRedPacketDisplay();
        }
    }

    // 开始监听聊天室变化
    function startChatroomMonitoring() {
        const chatContainer = document.getElementById('comments');
        if (!chatContainer) {
            console.error('未找到聊天室容器');
            setTimeout(startChatroomMonitoring, 2000);
            return;
        }

        // 创建观察器
        chatObserver = new MutationObserver((mutations) => {
            // 防抖处理，避免频繁调用
            const now = Date.now();
            if (now - lastProcessedTime < 500) return; // 500ms防抖
            lastProcessedTime = now;

            let hasNewMessages = false;

            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    hasNewMessages = true;
                }
            });

            if (hasNewMessages) {
                // 延迟执行，确保DOM完全加载
                setTimeout(scanLatestMessages, 200);
            }
        });

        // 开始观察
        chatObserver.observe(chatContainer, {
            childList: true,
            subtree: true
        });

        console.log('已开始监听聊天室变化');
    }

    // 获取红包ID
    function getRedPacketId(chatItem, redPacket) {
        // 从聊天项ID获取
        const chatId = chatItem.id;
        if (chatId && chatId.startsWith('chatroom')) {
            return chatId.replace('chatroom', '');
        }

        // 从红包点击事件获取
        const onclick = redPacket.getAttribute('onclick');
        if (onclick) {
            const match = onclick.match(/unpackRedPacket\('([^']+)'\)/);
            if (match) return match[1];
        }

        // 生成唯一ID
        const user = getMessageUser(chatItem).name;
        const time = getMessageTime(chatItem);
        return `${user}_${time}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 获取消息时间
    function getMessageTime(chatItem) {
        const timeElement = chatItem.querySelector('.date-bar');
        if (timeElement) {
            return timeElement.textContent.trim();
        }
        return '';
    }

    // 获取消息用户
    function getMessageUser(chatItem) {
        const userElement = chatItem.querySelector('#userName .ft-gray');
        const avatarElement = chatItem.querySelector('.avatar');

        return {
            name: userElement ? userElement.textContent.trim() : '匿名',
            avatar: avatarElement ? avatarElement.style.backgroundImage : '',
            level: chatItem.querySelector('.tip-wrapper') ? '高级用户' : '普通用户'
        };
    }

    // 获取红包状态
    function getRedPacketStatus(redPacket) {
        const desc = redPacket.querySelector('.redPacketDesc');
        if (!desc) return 'unknown';

        const descText = desc.textContent.toLowerCase();
        if (descText.includes('已经') || descText.includes('抢光') || descText.includes('抢完')) return 'empty';
        if (descText.includes('已领取')) return 'opened';
        if (descText.includes('未领取')) return 'available';
        if (descText.includes('过期')) return 'expired';
        return 'available';
    }

    // 删除指定红包
    function delRedPacket(id) {
        if (!CONFIG.autoDelRedPackets) {
            return;
        }
        // 使用 querySelector
        var element = document.querySelector('.red-packet-list .red-packet-item[data-packet-id="' + id +'"]');
        if (element) {
            // 删除红包
            element.remove();
            // 删除缓存数据
            redPackets.delete(id);
            displayOrder = displayOrder.filter(item => item == id);
            currentDisplayed.delete(id);
            //processedMessageIds.delete(id);
        }

    }

    // 设置红包观察器
    function setupRedPacketObserver(packetData) {
        // 如果红包已抢光，则不设置观察器
        if (packetData.status === 'empty') {
            console.log(`红包 ${packetData.id} 已抢光，不设置观察器`);
            //delRedPacket(packetData.id);
            return;
        }

        // 清理旧的观察器
        if (packetData.observer) {
            packetData.observer.disconnect();
        }

        // 创建新的观察器来监听红包状态变化
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;

            mutations.forEach((mutation) => {
                // 检查红包描述是否变化
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    const newStatus = getRedPacketStatus(packetData.originalRedPacket);
                    if (newStatus !== packetData.status) {
                        packetData.status = newStatus;
                        shouldUpdate = true;

                        // 如果红包被抢光，断开观察器以优化性能
                        if (newStatus === 'empty') {
                            //console.log(`红包 ${packetData.id} 已抢光，断开观察器`);
                            observer.disconnect();
                            packetData.observer = null;
                            observers.delete(packetData.id);
                            if (CONFIG.autoDelRedPackets) {
                                delRedPacket(packetData.id);
                                return;
                            }

                        }
                    }
                }

                // 检查类名或样式变化
                if (mutation.type === 'attributes') {
                    shouldUpdate = true;
                }
            });

            if (shouldUpdate) {
                updateRedPacketItem(packetData.id);
                packetData.lastUpdated = Date.now();
            }
        });

        // 观察红包元素的子节点和属性变化
        observer.observe(packetData.originalRedPacket, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'onclick']
        });

        packetData.observer = observer;
        observers.set(packetData.id, observer);
    }

    // 更新显示顺序
    function updateDisplayOrder() {
        // 按时间排序（最新的在前）
        displayOrder = Array.from(redPackets.keys()).sort((a, b) => {
            const packetA = redPackets.get(a);
            const packetB = redPackets.get(b);
            const timeA = parseTimeString(packetA.time);
            const timeB = parseTimeString(packetB.time);
            return timeB - timeA; // 降序排序，最新的在前
        });
    }

    // 辅助函数：将时间字符串转换为Date对象
    function parseTimeString(timeStr) {
        if (!timeStr) return new Date(0);
        const match = timeStr.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
        if (match) {
            return new Date(match[0].replace(/-/g, '/'));
        }
        return new Date(0);
    }

    // 更新红包显示
    function updateRedPacketDisplay() {
        const listContainer = document.querySelector('.red-packet-list');
        const countBadge = document.querySelector('.red-packet-count');

        if (!listContainer || !countBadge) return;

        // 更新计数
        countBadge.textContent = displayOrder.length;

        // 如果没有红包，显示提示
        if (displayOrder.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; color: #999; padding: 30px; font-size: 14px;">
                    🎈 还没有红包消息<br><small>聊天室发红包后会在这里显示</small>
                </div>
            `;
            return;
        }

        // 显示最新的红包（新的在最上面）
        const displayIds = displayOrder.slice(0, CONFIG.maxDisplayCount);
        currentDisplayed = new Set(displayIds);

        // 清空列表
        listContainer.innerHTML = '';

        // 按顺序添加红包，新的在最上面
        displayIds.forEach(packetId => {
            const packetData = redPackets.get(packetId);
            if (!packetData) return;

            const listItem = createRedPacketListItem(packetData);
            listContainer.appendChild(listItem);
        });
    }

    // 创建红包列表项
    function createRedPacketListItem(packetData) {
        // 创建容器
        const container = document.createElement('div');
        container.className = 'red-packet-item';
        container.dataset.packetId = packetData.id;

        // 根据是否为新红包设置样式
        if (packetData.isNew) {
            container.style.cssText = `
                border: 2px solid #ff4757;
                border-radius: 6px;
                padding: 10px;
                background: #fff;
                transition: all 0.2s ease;
                position: relative;
                overflow: hidden;
                margin-bottom: 10px;
                animation: newRedPacket 0.5s ease-out;
            `;

            // 添加新红包标记
            const newBadge = document.createElement('div');
            newBadge.style.cssText = `
                position: absolute;
                top: -6px;
                right: -6px;
                background: #ff4757;
                color: white;
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 10px;
                z-index: 2;
                font-weight: bold;
            `;
            newBadge.textContent = 'NEW';
            container.appendChild(newBadge);
        } else {
            container.style.cssText = `
                border: 1px solid #e0e0e0;
                border-radius: 6px;
                padding: 10px;
                background: #fff;
                transition: all 0.2s ease;
                position: relative;
                overflow: hidden;
                margin-bottom: 10px;
            `;
        }

        // 状态指示器
        const statusIndicator = document.createElement('div');
        statusIndicator.className = 'status-indicator';
        statusIndicator.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            width: 30px;
            height: 30px;
            clip-path: polygon(100% 0, 100% 100%, 0 0);
            z-index: 1;
        `;

        // 根据状态设置颜色
        const statusColors = {
            available: '#4CAF50',
            opened: '#2196F3',
            empty: '#FF9800',
            expired: '#9E9E9E',
            unknown: '#607D8B'
        };

        statusIndicator.style.background = statusColors[packetData.status] || '#607D8B';
        container.appendChild(statusIndicator);

        // 用户信息行
        const userRow = document.createElement('div');
        userRow.style.cssText = `
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid #f0f0f0;
        `;

        // 头像
        const avatar = document.createElement('div');
        avatar.className = 'red-packet-avatar';
        avatar.style.cssText = `
            width: 24px;
            height: 24px;
            border-radius: 50%;
            margin-right: 8px;
            background-size: cover;
            background-position: center;
        `;
        avatar.style.backgroundImage = packetData.user.avatar || 'none';
        avatar.style.backgroundColor = packetData.user.avatar ? 'transparent' : '#ccc';

        // 用户名
        const userName = document.createElement('span');
        userName.style.cssText = `
            font-weight: bold;
            color: #333;
            font-size: 14px;
            flex: 1;
        `;
        userName.textContent = packetData.user.name;

        // 时间
        const timeSpan = document.createElement('span');
        timeSpan.style.cssText = `
            font-size: 12px;
            color: #888;
        `;
        timeSpan.textContent = packetData.time.split(' ')[0]; // 只显示日期部分

        userRow.appendChild(avatar);
        userRow.appendChild(userName);
        userRow.appendChild(timeSpan);

        // 红包内容（完整克隆）
        const redPacketContent = packetData.element.querySelector('.chats__content').cloneNode(true);

        // 调整红包内容样式
        redPacketContent.style.cssText = `
            margin: 0;
            padding: 0;
            transform: scale(0.85);
            transform-origin: top left;
        `;

        // 更新点击事件，使其指向原红包
        const redPacketBtn = redPacketContent.querySelector('.hongbao__item');
        if (redPacketBtn && packetData.originalRedPacket) {
            const originalOnclick = packetData.originalRedPacket.getAttribute('onclick');
            if (originalOnclick) {
                redPacketBtn.setAttribute('onclick', originalOnclick);

                // 确保点击时触发原事件
                redPacketBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    // 调用原红包的点击事件
                    if (packetData.originalRedPacket) {
                        packetData.originalRedPacket.click();
                    }
                });
            }
        }

        // 移除多余的操作按钮
        const actionButtons = redPacketContent.querySelectorAll('.action__item, .fn__layer, details');
        actionButtons.forEach(btn => btn.remove());

        // 组装容器
        container.appendChild(userRow);
        container.appendChild(redPacketContent);

        // 添加悬停效果
        container.addEventListener('mouseenter', function() {
            this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            this.style.transform = 'translateY(-2px)';
        });

        container.addEventListener('mouseleave', function() {
            this.style.boxShadow = '';
            this.style.transform = '';
        });

        // 点击事件：高亮原聊天室中的红包
        container.addEventListener('click', function(e) {
            if (!e.target.closest('.hongbao__item')) {
                highlightOriginalRedPacket(packetData.id);
            }
        });

        return container;
    }

    // 更新单个红包项
    function updateRedPacketItem(packetId) {
        const packetData = redPackets.get(packetId);
        if (!packetData) return;

        // 重新克隆最新的红包元素
        packetData.element = packetData.originalElement.cloneNode(true);
        packetData.redPacketElement = packetData.element.querySelector('.hongbao__item');
        packetData.status = getRedPacketStatus(packetData.originalRedPacket);
        packetData.lastUpdated = Date.now();

        // 如果这个红包正在显示中，更新显示
        if (currentDisplayed.has(packetId)) {
            const listContainer = document.querySelector('.red-packet-list');
            if (!listContainer) return;

            const existingItem = listContainer.querySelector(`[data-packet-id="${packetId}"]`);
            if (existingItem) {
                // 获取当前红包的位置
                const allItems = Array.from(listContainer.children);
                const currentIndex = allItems.findIndex(item =>
                    item.dataset.packetId === packetId
                );

                // 移除旧项
                existingItem.remove();

                // 创建新项
                const newItem = createRedPacketListItem(packetData);

                // 插入到相同位置（保持红包在列表中的位置不变）
                if (currentIndex >= 0 && currentIndex < allItems.length - 1) {
                    listContainer.insertBefore(newItem, listContainer.children[currentIndex]);
                } else {
                    listContainer.appendChild(newItem);
                }
            }
        }
    }

    // 高亮原聊天室中的红包
    function highlightOriginalRedPacket(packetId) {
        const packetData = redPackets.get(packetId);
        if (!packetData || !packetData.originalElement) return;

        // 移除之前的高亮
        document.querySelectorAll('.red-packet-highlight').forEach(el => {
            el.classList.remove('red-packet-highlight');
        });

        // 添加高亮效果
        packetData.originalElement.classList.add('red-packet-highlight');

        // 滚动到原红包位置
        packetData.originalElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });

        // 3秒后移除高亮
        setTimeout(() => {
            packetData.originalElement.classList.remove('red-packet-highlight');
        }, 3000);
    }

    // 开始定时任务
    function startTimers() {
        // 定期全量扫描（间隔延长到10秒）
        setInterval(scanRedPackets, CONFIG.refreshInterval);

        // 定期同步红包状态
        setInterval(syncRedPacketStates, CONFIG.syncInterval);
    }

    // 同步红包状态
    function syncRedPacketStates() {
        redPackets.forEach((packetData, packetId) => {
            if (!packetData.originalElement || !packetData.originalElement.parentNode) {
                // 原红包已不存在，清理
                cleanupRedPacket(packetId);
                return;
            }

            // 检查状态是否变化
            const newStatus = getRedPacketStatus(packetData.originalRedPacket);
            if (newStatus !== packetData.status) {
                updateRedPacketItem(packetId);

                // 如果红包被抢光，清理观察器
                if (newStatus === 'empty' && packetData.observer) {
                    packetData.observer.disconnect();
                    packetData.observer = null;
                    observers.delete(packetId);
                }
            }
        });
    }

    // 清理红包
    function cleanupRedPacket(packetId) {
        const packetData = redPackets.get(packetId);
        if (packetData && packetData.observer) {
            packetData.observer.disconnect();
        }

        redPackets.delete(packetId);
        observers.delete(packetId);
        currentDisplayed.delete(packetId);
        processedMessageIds.delete(packetId);

        // 从DOM中移除
        const item = document.querySelector(`[data-packet-id="${packetId}"]`);
        if (item) item.remove();
    }

    // 添加事件监听
    function addEventListeners() {
        // 监听红包面板的滚动事件
        const panelBody = document.querySelector('.red-packet-body');
        if (panelBody) {
            panelBody.addEventListener('scroll', function() {
                // 可以在这里添加懒加载等逻辑
            });
        }
    }

    // 添加CSS样式
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 红包面板样式 */
            .red-packet-module {
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }

            .red-packet-body {
                scrollbar-width: thin;
                scrollbar-color: #ff6b6b #f0f0f0;
            }

            .red-packet-body::-webkit-scrollbar {
                width: 6px;
            }

            .red-packet-body::-webkit-scrollbar-track {
                background: #f0f0f0;
                border-radius: 3px;
            }

            .red-packet-body::-webkit-scrollbar-thumb {
                background: #ff6b6b;
                border-radius: 3px;
            }

            .red-packet-body::-webkit-scrollbar-thumb:hover {
                background: #ff4757;
            }

            /* 红包项样式 */
            .red-packet-item {
                position: relative;
            }

            .red-packet-item:hover {
                border-color: #ff6b6b;
            }

            .red-packet-avatar::before {
                content: '';
                display: block;
                width: 100%;
                height: 100%;
                border-radius: 50%;
                background: linear-gradient(45deg, #ff6b6b, #ff8e53);
                opacity: 0.1;
            }

            /* 新红包动画 */
            @keyframes newRedPacket {
                0% {
                    transform: translateY(-20px);
                    opacity: 0;
                }
                100% {
                    transform: translateY(0);
                    opacity: 1;
                }
            }

            /* 高亮效果 */
            .red-packet-highlight {
                animation: highlightPulse 1s ease-in-out 3;
                border: 2px solid #ff6b6b !important;
            }

            @keyframes highlightPulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0.4); }
                50% { box-shadow: 0 0 0 10px rgba(255, 107, 107, 0); }
            }

            /* 响应式调整 */
            @media (max-width: 768px) {
                .red-packet-body {
                    max-height: 300px !important;
                }

                .red-packet-item {
                    padding: 8px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addStyles();
            setTimeout(init, 1500);
        });
    } else {
        addStyles();
        setTimeout(init, 1500);
    }

    // 导出调试函数
    window.RedPacketManager = {
        rescan: function() {
            scanRedPackets();
            console.log(`重新扫描，共发现 ${redPackets.size} 个红包`);
        },
        scanLatest: function() {
            scanLatestMessages();
            console.log('扫描最新消息完成');
        },
        syncAll: function() {
            syncRedPacketStates();
            console.log('已同步所有红包状态');
        },
        getStats: function() {
            const stats = {
                total: redPackets.size,
                available: 0,
                opened: 0,
                empty: 0,
                expired: 0,
                observed: observers.size
            };

            redPackets.forEach(packet => {
                stats[packet.status] = (stats[packet.status] || 0) + 1;
            });

            return stats;
        },
        getPacket: function(packetId) {
            return redPackets.get(packetId);
        },
        cleanupObservers: function() {
            let cleaned = 0;
            redPackets.forEach((packet, id) => {
                if (packet.status === 'empty' && packet.observer) {
                    packet.observer.disconnect();
                    packet.observer = null;
                    observers.delete(id);
                    cleaned++;
                }
            });
            console.log(`清理了 ${cleaned} 个已抢光红包的观察器`);
        }
    };

    console.log('红包同步脚本已加载，使用 RedPacketManager 进行调试');
})();
