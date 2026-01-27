// ==UserScript==
// @name         鱼排红包板块
// @namespace    https://fishpi.cn
// @license      MIT
// @version      1.3.5
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
// 2026-01-13 muli 新增切换浮窗模式按钮，新增不捕获的红包类型配置，新增配置面板
// 2026-01-14 muli 新增背景颜色配置，新增最小化，最小化后的小图标可右键，会提醒有效的红包，点击后展开定位到指定红包
// 2026-01-21 muli 修复报错问题，过滤红包可选择板块是否进行捕获
// 2026-01-26 muli 遗弃了定时全量扫描机制，优化了脚本卡顿情况
// 2026-01-27 muli 修复没有红包时，板块的提示显示不更新

(function() {
    'use strict';

    // 配置
    const CONFIG = {
        maxDisplayCount: 20,          // 最多显示红包数量
        visibleCount: 5,              // 默认可见红包数量
        refreshInterval: 30000,       // 全量扫描间隔（延长到10秒）
        syncInterval: 1000,           // 同步状态间隔
        preserveOriginal: true,       // 保留原清风明月
        position: 'above',           // 红包面板位置: above(上方) / below(下方)
        autoScrollNew: false,         // 关闭自动滚动到新红包（新的在上面）
        monitorNewMessages: true,     // 监听新消息
        newMessageThreshold: 5,        // 每次扫描的新消息数量
        autoDelRedPackets: false,        // 是否自动删除已抢光的红包
        // 过滤的红包类型
        filterRedPacketTypes: ['猜拳红包'],  // 例如：['普通红包', '专属红包', '猜拳红包']

        // 是否启用红包类型过滤
        enableRedPacketFilter: false,
        // 红包板块是否不显示过滤红包
        enableRedPacketModuleFilter: false,
        backgroundColor: '#ffffff',           // 红包板块背景颜色
    };

    // 单个红包高度
    const one_item_height = 200;

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

    // 最小化全局变量
    let isMinimized = false;                  // 是否已最小化
    let minimizedIcon = null;                 // 最小化图标元素
    let hasNewRedPacketAlert = false;         // 是否有新红包提醒
    let alertRedPacketIds = new Set();        // 需要提醒的红包ID集合
    let alertAnimationInterval = null;        // 提醒动画间隔

    // 浮窗状态存储
    let isFloatingWindow = false;
    let floatingWindowData = null;

    // 主初始化函数
    function init() {
        if (isInitialized) return;

        console.log('红包同步脚本初始化...');
        // 从localStorage加载配置
        loadConfigFromStorage();

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

        // 根据配置刷新样式
        updatePanelStyles();

        // 初始全量扫描
        scanRedPackets();

        // 开始监听聊天室变化
        startChatroomMonitoring();

        // 开始定时任务（遗弃全量扫描）
        //startTimers();

        // 添加事件监听
        addEventListeners();

        isInitialized = true;

        // 新增：检查初始最小化状态
        checkInitialMinimizedState();


        //console.log('红包同步脚本初始化完成');

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

        // 新增最小化按钮
        const minimizeBtn = document.createElement('button');
        minimizeBtn.className = 'minimize-btn';
        minimizeBtn.innerHTML = '−'; // 减号表示最小化
        minimizeBtn.title = '最小化';
        minimizeBtn.style.cssText = `
            width: 24px;
            height: 24px;
            border-radius: 50% !important;
            background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%) !important;
            color: white !important;
            font-size: 16px !important;
            font-weight: bold !important;
            cursor: pointer !important;
            box-shadow: 0 4px 15px rgba(106, 17, 203, 0.4) !important;
            border: 3px solid white !important;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 5px;
            padding: 0;
            line-height: 1;
        `;

        // 添加最小化按钮事件
        minimizeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleMinimizeMode();
        });

        // 将最小化按钮添加到控制区域
        controls.appendChild(minimizeBtn);

        // 添加切换浮窗模式按钮
        const floatingBtn = document.createElement('button');
        floatingBtn.className = 'floating-window-btn';
        floatingBtn.innerHTML = '⇄';
        floatingBtn.title = '切换浮窗模式';
        floatingBtn.style.cssText = `
            width: 24px;
            height: 24px;
            border-radius: 50% !important;
            background: linear-gradient(135deg, #2b8a3e 0%, #20c997 100%) !important;
            color: white !important;
            font-size: 14px !important;
            font-weight: bold !important;
            cursor: pointer !important;
            box-shadow: 0 4px 15px rgba(32, 201, 151, 0.4) !important;
            border: 3px solid white !important;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 5px;
            padding: 0;
            line-height: 1;
        `;

        // 添加浮窗切换功能
        floatingBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleFloatingWindow(panel);
        });

        controls.appendChild(floatingBtn);

        header.appendChild(title);
        header.appendChild(controls);



        // 面板主体
        const body = document.createElement('div');
        body.className = 'module-panel red-packet-body';
        body.style.cssText = `
            max-height: ${CONFIG.visibleCount * one_item_height}px;
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
                body.style.maxHeight = `${CONFIG.visibleCount * one_item_height}px`;
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
        //console.log('执行全量红包扫描...');
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

        // 检查是否应该过滤此红包类型
        if (CONFIG.enableRedPacketFilter && CONFIG.filterRedPacketTypes.length > 0) {
            // 获取红包类型
            const redPacketType = getRedPacketType(redPacket);
            if (CONFIG.filterRedPacketTypes.includes(redPacketType)) {
                //console.log(`过滤红包类型: ${redPacketType} (红包ID: ${packetId})`);

                // 修改为在聊天室中屏蔽该红包
                item.style.display = 'none';
                if (CONFIG.enableRedPacketModuleFilter) {
                    return; // 跳过此红包
                }

            }
        }

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

            // 新增：如果红包状态为可领取且面板已最小化，则添加提醒
            if (packetData.status !== 'empty' && isMinimized) {
                addRedPacketAlert(packetId);
            }

            // 创建观察器来监听红包状态变化
            setupRedPacketObserver(packetData);
        }
    }

    // 获取红包类型
    function getRedPacketType(redPacket) {
        const typeElement = redPacket.querySelector('b');
        if (!typeElement) return '未知红包';

        const typeText = typeElement.textContent.trim();

        // 定义已知的红包类型
        const knownTypes = [
            '拼手气红包',
            '普通红包',
            '专属红包',
            '心跳红包',
            '猜拳红包',
            '石头剪刀布红包'  // 有些页面可能显示这个
        ];

        // 检查是否为已知类型
        for (const knownType of knownTypes) {
            if (typeText.includes(knownType)) {
                return knownType;
            }
        }

        return typeText; // 返回原始文本
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

        //console.log('扫描最新消息...');
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
        }
        updateRedPacketDisplay();
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

        //console.log('已开始监听聊天室变化');
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
            //console.log(`红包 ${packetData.id} 已抢光，不设置观察器`);
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

                        // 新增：如果状态变为可领取且面板已最小化，则添加提醒
                        if (newStatus !== 'empty' && isMinimized) {
                            addRedPacketAlert(packetData.id);
                        } else if (newStatus === 'empty' && isMinimized) {
                            delRedPacketAlert(packetData.id);
                        }

                        // 如果红包被抢光，断开观察器以优化性能
                        if (newStatus === 'empty') {
                            //console.log(`红包 ${packetData.id} 已抢光，断开观察器`);
                            observer.disconnect();
                            packetData.observer = null;
                            observers.delete(packetData.id);
                            // 更新板块显示
                            updateRedPacketDisplay();
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
                background: ${CONFIG.backgroundColor};
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
                background: ${CONFIG.backgroundColor};
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
            background: ${CONFIG.backgroundColor};
            transform: scale(0.85);
            transform-origin: top left;
        `;

        // 更新点击事件，使其指向原红包
        // const redPacketBtn = redPacketContent.querySelector('.hongbao__item');
        // if (redPacketBtn && packetData.originalRedPacket) {
        //     const originalOnclick = packetData.originalRedPacket.getAttribute('onclick');
        //     if (originalOnclick) {
        //         redPacketBtn.setAttribute('onclick', originalOnclick);
        //
        //         // 确保点击时触发原事件
        //         redPacketBtn.addEventListener('click', function(e) {
        //             e.stopPropagation();
        //             // 调用原红包的点击事件
        //             if (packetData.originalRedPacket) {
        //                 packetData.originalRedPacket.click();
        //             }
        //         });
        //     }
        // }

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

    // 新增：创建最小化图标（浮动小红包）
    function createMinimizedIcon() {
        if (minimizedIcon) return minimizedIcon;

        const icon = document.createElement('div');
        icon.className = 'red-packet-minimized-icon';
        icon.style.cssText = `
            position: fixed;
            bottom: 100px;
            right: 30px;
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #ff6b6b, #ff8e53);
            border-radius: 50%;
            cursor: move;
            z-index: 10001;
            box-shadow: 0 6px 20px rgba(255, 107, 107, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            color: white;
            font-weight: bold;
            transition: all 0.3s ease;
            user-select: none;
            border: 3px solid white;
        `;
        icon.innerHTML = '🧧';
        icon.title = '点击展开红包面板';

        // 添加可拖动功能
        makeMinimizedIconDraggable(icon);

        // 点击事件：展开红包面板
        setupMinimizedIconClickHandler(icon);

        // 右键菜单：显示提醒的红包数量
        icon.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showMinimizedIconContextMenu(e, icon);
        });

        document.body.appendChild(icon);
        minimizedIcon = icon;

        return icon;
    }

    // 新增：使最小化图标可拖动
    function makeMinimizedIconDraggable(icon) {
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        icon.addEventListener('mousedown', startDrag);

        function startDrag(e) {
            // 如果点击的是图标本身而不是内部元素，才允许拖动
            if (e.target !== icon && !icon.contains(e.target)) return;

            isDragging = true;
            const rect = icon.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;

            icon.style.cursor = 'grabbing';
            icon.style.opacity = '0.9';
            icon.style.transition = 'none'; // 关闭过渡效果，使拖动更跟手

            // 使用requestAnimationFrame实现流畅拖动
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);

            e.preventDefault();
            e.stopPropagation(); // 阻止事件冒泡
        }

        function doDrag(e) {
            if (!isDragging) return;

            // 使用requestAnimationFrame优化性能
            requestAnimationFrame(() => {
                const newLeft = e.clientX - dragOffsetX;
                const newTop = e.clientY - dragOffsetY;

                // 限制在可视区域内
                const maxX = window.innerWidth - icon.offsetWidth;
                const maxY = window.innerHeight - icon.offsetHeight;

                icon.style.left = Math.max(10, Math.min(newLeft, maxX)) + 'px';
                icon.style.top = Math.max(10, Math.min(newTop, maxY)) + 'px';
                icon.style.right = 'auto';
                icon.style.bottom = 'auto';
            });
        }

        function stopDrag(e) {
            if (!isDragging) return;

            isDragging = false;
            icon.style.cursor = 'move';
            icon.style.opacity = '1';
            icon.style.transition = 'all 0.3s ease'; // 恢复过渡效果

            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);

            // 保存位置到localStorage
            saveMinimizedIconPosition();


            e.preventDefault();
            e.stopPropagation(); // 阻止事件冒泡
        }
    }

    // 小红包点击事件
    function setupMinimizedIconClickHandler(icon) {
        // 使用标志位来区分拖动和点击
        let isClickable = true;
        let mouseDownTime = 0;
        let mouseDownX = 0;
        let mouseDownY = 0;

        icon.addEventListener('mousedown', function(e) {
            mouseDownTime = Date.now();
            mouseDownX = e.clientX;
            mouseDownY = e.clientY;
            isClickable = true;

            // 设置超时，如果按下时间超过300ms，认为是拖动而不是点击
            setTimeout(() => {
                if (Date.now() - mouseDownTime > 300) {
                    isClickable = false;
                }
            }, 300);
        });

        icon.addEventListener('click', function(e) {

            // 检查是否是有效的点击（不是拖动）
            const clickDuration = Date.now() - mouseDownTime;
            const moveDistance = Math.sqrt(
                Math.pow(e.clientX - mouseDownX, 2) +
                Math.pow(e.clientY - mouseDownY, 2)
            );

            // 如果点击时间超过300ms或移动距离超过5像素，认为是拖动
            if (clickDuration > 300 || moveDistance > 10) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // 只有有效的点击才展开面板
            if (isClickable) {
                toggleMinimizeMode();
            }
        });
    }

    // 新增：保存最小化图标位置
    function saveMinimizedIconPosition() {
        if (!minimizedIcon) return;

        try {
            const rect = minimizedIcon.getBoundingClientRect();
            const position = {
                x: rect.left,
                y: rect.top
            };
            localStorage.setItem('redPacketMinimizedIconPosition', JSON.stringify(position));
        } catch (error) {
            console.error('保存最小化图标位置失败:', error);
        }
    }

    // 新增：加载最小化图标位置
    function loadMinimizedIconPosition() {
        try {
            const savedPosition = localStorage.getItem('redPacketMinimizedIconPosition');
            if (savedPosition && minimizedIcon) {
                const position = JSON.parse(savedPosition);

                // 确保位置在可视区域内
                const maxX = window.innerWidth - minimizedIcon.offsetWidth;
                const maxY = window.innerHeight - minimizedIcon.offsetHeight;

                const x = Math.max(10, Math.min(position.x, maxX));
                const y = Math.max(10, Math.min(position.y, maxY));

                minimizedIcon.style.left = x + 'px';
                minimizedIcon.style.top = y + 'px';
                minimizedIcon.style.right = 'auto';
                minimizedIcon.style.bottom = 'auto';
            }
        } catch (error) {
            console.error('加载最小化图标位置失败:', error);
        }
    }

    // 新增：切换最小化模式
    function toggleMinimizeMode() {
        const redPacketPanel = document.querySelector('.red-packet-module');
        const minimizeBtn = document.querySelector('.minimize-btn');

        if (!redPacketPanel || !minimizeBtn) return;

        if (isMinimized) {
            // 恢复面板
            redPacketPanel.style.display = '';
            if (minimizedIcon) {
                minimizedIcon.style.display = 'none';
            }
            minimizeBtn.innerHTML = '−';
            minimizeBtn.title = '最小化';
            minimizeBtn.style.background = 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%) !important';

            // 如果有提醒的红包，定位到第一个
            if (alertRedPacketIds.size > 0) {
                const firstAlertId = Array.from(alertRedPacketIds)[0];
                highlightOriginalRedPacket(firstAlertId);

                // 清除提醒状态
                clearAlertAnimation();
                alertRedPacketIds.clear();
                hasNewRedPacketAlert = false;
            }
        } else {
            // 最小化面板
            redPacketPanel.style.display = 'none';
            const icon = createMinimizedIcon();
            icon.style.display = 'flex';
            loadMinimizedIconPosition();
            minimizeBtn.innerHTML = '＋';
            minimizeBtn.title = '恢复面板';
            minimizeBtn.style.background = 'linear-gradient(135deg, #20c997 0%, #2b8a3e 100%) !important';
        }

        isMinimized = !isMinimized;

        // 保存状态到localStorage
        try {
            localStorage.setItem('redPacketMinimizedState', isMinimized.toString());
        } catch (error) {
            console.error('保存最小化状态失败:', error);
        }
    }

    // 新增：显示最小化图标的右键菜单
    function showMinimizedIconContextMenu(e, icon) {
        // 移除旧的右键菜单
        const oldMenu = document.querySelector('.minimized-icon-context-menu');
        if (oldMenu) oldMenu.remove();

        // 创建右键菜单
        const menu = document.createElement('div');
        menu.className = 'minimized-icon-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${e.clientX}px;
            top: ${e.clientY}px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10002;
            min-width: 150px;
            padding: 8px 0;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        `;

        menu.innerHTML = `
            <div style="padding: 8px 16px; font-size: 12px; color: #666; border-bottom: 1px solid #f0f0f0;">
                红包提醒: ${alertRedPacketIds.size} 个新红包
            </div>
            <div class="context-menu-item" style="padding: 8px 16px; font-size: 13px; cursor: pointer; transition: background 0.2s;">
                展开面板
            </div>
            <div class="context-menu-item" style="padding: 8px 16px; font-size: 13px; cursor: pointer; transition: background 0.2s;">
                清除提醒
            </div>
            <div class="context-menu-item" style="padding: 8px 16px; font-size: 13px; cursor: pointer; transition: background 0.2s; border-top: 1px solid #f0f0f0;">
                停靠位置
            </div>
        `;

        // 添加事件监听
        const items = menu.querySelectorAll('.context-menu-item');
        items[0].addEventListener('click', function() {
            toggleMinimizeMode();
            menu.remove();
        });

        items[1].addEventListener('click', function() {
            clearAlertAnimation();
            alertRedPacketIds.clear();
            hasNewRedPacketAlert = false;
            if (minimizedIcon) {
                minimizedIcon.style.animation = '';
                minimizedIcon.style.boxShadow = '0 6px 20px rgba(255, 107, 107, 0.5)';
            }
            menu.remove();
        });

        items[2].addEventListener('click', function() {
            // 停靠到屏幕边缘
            if (minimizedIcon) {
                minimizedIcon.style.left = 'auto';
                minimizedIcon.style.top = 'auto';
                minimizedIcon.style.right = '30px';
                minimizedIcon.style.bottom = '100px';
                saveMinimizedIconPosition();
            }
            menu.remove();
        });

        document.body.appendChild(menu);

        // 点击其他地方关闭菜单
        const closeMenu = function() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    // 新增：添加新红包提醒
    function addRedPacketAlert(packetId) {
        if (isMinimized && packetId) {
            alertRedPacketIds.add(packetId);
            hasNewRedPacketAlert = true;

            // 启动提醒动画
            startAlertAnimation();
        }
    }

    // 新增：删除新红包提醒
    function delRedPacketAlert(packetId) {
        if (isMinimized && packetId) {
            var index = alertRedPacketIds.delete(packetId);
            if (alertRedPacketIds.size < 1) {
                hasNewRedPacketAlert = false;
                clearAlertAnimation();
            }
        }
    }

    // 新增：启动提醒动画
    function startAlertAnimation() {
        if (!minimizedIcon || !hasNewRedPacketAlert) return;

        // 清除之前的动画
        clearAlertAnimation();

        // 创建闪烁动画
        let isRed = false;
        alertAnimationInterval = setInterval(() => {
            if (minimizedIcon) {
                if (isRed) {
                    minimizedIcon.style.background = 'linear-gradient(135deg, #ff6b6b, #ff8e53)';
                    minimizedIcon.style.boxShadow = '0 6px 20px rgba(255, 107, 107, 0.5)';
                } else {
                    minimizedIcon.style.background = 'linear-gradient(135deg, #ff0000, #ff4757)';
                    minimizedIcon.style.boxShadow = '0 6px 20px rgba(255, 0, 0, 0.7)';
                }
                isRed = !isRed;
            }
        }, 600); // 每600ms切换一次颜色
    }

    // 新增：清除提醒动画
    function clearAlertAnimation() {
        if (alertAnimationInterval) {
            clearInterval(alertAnimationInterval);
            alertAnimationInterval = null;
        }

        if (minimizedIcon) {
            minimizedIcon.style.animation = '';
            minimizedIcon.style.background = 'linear-gradient(135deg, #ff6b6b, #ff8e53)';
            minimizedIcon.style.boxShadow = '0 6px 20px rgba(255, 107, 107, 0.5)';
        }
    }


    // 切换浮窗模式
    function toggleFloatingWindow(panel) {

        if (isFloatingWindow) {
            // 切换到停靠模式
            restoreToDockedMode(panel);
        } else {
            // 切换到浮窗模式
            switchToFloatingMode(panel);
        }

        isFloatingWindow = !isFloatingWindow;
        localStorage.setItem('redPacketIsFloatingWindow', isFloatingWindow);
        updateFloatingButtonState();
    }

    // 加载浮窗模式
    function loadFloatingWindow(panel) {

        if (isFloatingWindow) {
            // 切换到浮窗模式
            switchToFloatingMode(panel);
        } else {
            // 切换到停靠模式
            restoreToDockedMode(panel);
        }

        updateFloatingButtonState();
    }

    // 切换到浮窗模式
    function switchToFloatingMode(panel) {
        // 保存原始位置信息
        const parent = panel.parentNode;
        const nextSibling = panel.nextSibling;
        const originalStyle = panel.getAttribute('style');

        floatingWindowData = {
            parent: parent,
            nextSibling: nextSibling,
            originalStyle: originalStyle,
            originalPosition: {
                top: panel.offsetTop,
                left: panel.offsetLeft
            }
        };

        // 设置为浮窗样式
        panel.style.cssText = `
        position: fixed !important;
        top: 100px !important;
        right: 20px !important;
        width: 320px !important;
        z-index: 10000 !important;
        background: #fff !important;
        border: 2px solid #20c997 !important;
        border-radius: 12px !important;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2) !important;
        margin-bottom: 0 !important;
        max-height: ${CONFIG.visibleCount * one_item_height}px !important;
        overflow: hidden !important;
        resize: both !important;
        min-width: 300px !important;
        min-height: 200px !important;
    `;

        // 使面板可拖动
        makePanelDraggable(panel);

        // 添加到body
        document.body.appendChild(panel);

        localStorage.setItem('redPacketFloatingWindowData', JSON.stringify(floatingWindowData));

        //console.log('已切换到浮窗模式');
    }

    // 恢复到停靠模式
    function restoreToDockedMode(panel) {
        if (!floatingWindowData) return;

        // 移除可拖动功能
        panel.style.cursor = '';
        panel.removeAttribute('data-dragging');

        // 恢复原始样式
        panel.style.cssText = floatingWindowData.originalStyle || `
            margin-bottom: 15px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
        `;

        // 恢复到原始位置
        if (floatingWindowData.parent) {
            if (floatingWindowData.nextSibling) {
                try {
                    floatingWindowData.parent.insertBefore(panel, floatingWindowData.nextSibling);
                } catch (err) {
                    //console.error('初始化停靠异常:', err);
                    //resolve();
                }

            } else {
                floatingWindowData.parent.appendChild(panel);
            }
        }


        localStorage.setItem('redPacketFloatingWindowData', JSON.stringify(floatingWindowData));

        //console.log('已恢复到停靠模式');
    }

    // 更新浮窗按钮状态
    function updateFloatingButtonState() {
        const floatingBtn = document.querySelector('.floating-window-btn');
        if (!floatingBtn) return;

        if (isFloatingWindow) {
            floatingBtn.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ff8e53 100%) !important';
            floatingBtn.style.boxShadow = '0 4px 15px rgba(255, 107, 107, 0.4) !important';
            floatingBtn.title = '切换为停靠模式';
        } else {
            floatingBtn.style.background = 'linear-gradient(135deg, #2b8a3e 0%, #20c997 100%) !important';
            floatingBtn.style.boxShadow = '0 4px 15px rgba(32, 201, 151, 0.4) !important';
            floatingBtn.title = '切换为浮窗模式';
        }
    }

    // 使面板可拖动
    function makePanelDraggable(panel) {
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        // 面板头部作为拖动区域
        const header = panel.querySelector('.module-header');
        if (!header) return;

        header.style.cursor = 'move';

        header.addEventListener('mousedown', startDrag);

        function startDrag(e) {
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;

            panel.style.cursor = 'grabbing';
            panel.setAttribute('data-dragging', 'true');

            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);

            e.preventDefault();
        }

        function doDrag(e) {
            if (!isDragging) return;

            // 计算新位置
            const newLeft = e.clientX - dragOffsetX;
            const newTop = e.clientY - dragOffsetY;

            // 限制在可视区域内
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;

            panel.style.left = Math.max(0, Math.min(newLeft, maxX)) + 'px';
            panel.style.top = Math.max(0, Math.min(newTop, maxY)) + 'px';
            panel.style.right = 'auto';
        }

        function stopDrag() {
            isDragging = false;
            panel.style.cursor = '';
            panel.removeAttribute('data-dragging');

            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
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

            /*  浮窗模式样式 */
            .floating-window-mode {
                z-index: 9999 !important;
            }
            
            .red-packet-module[data-dragging="true"] {
                opacity: 0.9;
                box-shadow: 0 15px 40px rgba(0,0,0,0.3) !important;
            }
            
            /* 响应式调整浮窗 */
            @media (max-width: 768px) {
                .red-packet-module.floating-window-mode {
                    width: 280px !important;
                    max-height: 60vh !important;
                    top: 50px !important;
                    right: 10px !important;
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
            //console.log(`重新扫描，共发现 ${redPackets.size} 个红包`);
        },
        scanLatest: function() {
            scanLatestMessages();
            //console.log('扫描最新消息完成');
        },
        syncAll: function() {
            syncRedPacketStates();
            //console.log('已同步所有红包状态');
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
            //console.log(`清理了 ${cleaned} 个已抢光红包的观察器`);
        },
        // 新增：设置过滤的红包类型
        setFilterTypes: function(types) {
            CONFIG.filterRedPacketTypes = Array.isArray(types) ? types : [];
            console.log(`已设置过滤的红包类型: ${CONFIG.filterRedPacketTypes.join(', ')}`);
            // 重新扫描以应用新的过滤规则
            this.rescan();
        },

        // 新增：启用/禁用红包过滤
        toggleFilter: function(enabled) {
            CONFIG.enableRedPacketFilter = enabled;
            console.log(`红包类型过滤已${enabled ? '启用' : '禁用'}`);
            this.rescan();
        },

        // 新增：获取当前过滤的红包类型
        getFilterTypes: function() {
            return CONFIG.filterRedPacketTypes;
        },
        getConfig: function() {
            return Object.assign({}, CONFIG);
        },
        setConfig: function(newConfig) {
            Object.assign(CONFIG, newConfig);
            saveConfigToStorage();
            updatePanelStyles();
            //console.log('配置已更新');
        },
        openConfig: function() {
            const configPanel = document.querySelector('.red-packet-config');
            if (configPanel) {
                initializeConfigForm(); // 刷新表单
                configPanel.style.display = 'block';
            }
        },
        closeConfig: function() {
            const configPanel = document.querySelector('.red-packet-config');
            if (configPanel) {
                configPanel.style.display = 'none';
            }
        },
    };

    //console.log('红包同步脚本已加载，使用 RedPacketManager 进行调试');

    // 创建综合配置面板
    function createConfigPanel() {
        // 如果已存在配置面板，则移除重建
        const existingPanel = document.querySelector('.red-packet-config');
        if (existingPanel) existingPanel.remove();

        // 创建配置面板容器
        const configPanel = document.createElement('div');
        configPanel.className = 'red-packet-config';
        configPanel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 2px solid #ff6b6b;
            border-radius: 12px;
            padding: 20px;
            z-index: 10002;
            box-shadow: 0 10px 40px rgba(0,0,0,0.25);
            width: 400px;
            max-width: 90vw;
            max-height: 80vh;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: none;
        `;

        // 配置面板标题
        configPanel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee;">
            <h3 style="margin: 0; color: #ff6b6b; font-size: 18px;">🎁 红包面板配置</h3>
            <button id="closeConfig" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999; padding: 0;">×</button>
        </div>
        
        <div class="config-section" style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #333; font-size: 14px;">📊 显示设置</h4>
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span>最大显示红包数量:</span>
                    <input type="number" id="maxDisplayCount" min="5" max="100" 
                           style="width: 80px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;">
                </label>
            </div>
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span>默认可见红包数量:</span>
                    <input type="number" id="visibleCount" min="1" max="20" 
                           style="width: 80px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;">
                </label>
            </div>
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span>实时扫描新消息数量:</span>
                    <input type="number" id="newMessageThreshold" min="1" max="20" 
                           style="width: 80px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;">
                </label>
            </div>
        </div>
        
        <div class="config-section" style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #333; font-size: 14px;">⚙️ 功能设置</h4>
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; align-items: center; font-size: 13px;">
                    <input type="checkbox" id="autoScrollNew" style="margin-right: 8px;">
                    自动滚动到最新红包
                </label>
            </div>
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; align-items: center; font-size: 13px;">
                    <input type="checkbox" id="monitorNewMessages" style="margin-right: 8px;">
                    实时监听新消息
                </label>
            </div>
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; align-items: center; font-size: 13px;">
                    <input type="checkbox" id="autoDelRedPackets" style="margin-right: 8px;">
                    自动删除已抢光的红包
                </label>
            </div>
        </div>
        
        <div class="config-section" style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #333; font-size: 14px;">🚫 红包类型过滤</h4>
            <div class="config-item" style="margin-bottom: 8px;">
                <label style="display: flex; align-items: center; font-size: 13px;">
                    <input type="checkbox" id="enableRedPacketFilter" style="margin-right: 8px;">
                    启用红包类型过滤
                </label>
                <br/>
                <label style="display: flex; align-items: center; font-size: 13px;">
                    <input type="checkbox" id="enableRedPacketModuleFilter" style="margin-right: 8px;">
                    红包板块不显示过滤红包
                </label>
            </div>
            <div style="margin-left: 20px; border-left: 2px solid #f0f0f0; padding-left: 15px;">
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">过滤以下红包类型（聊天室和板块都将不出现该红包）:</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                    <label style="display: flex; align-items: center; font-size: 12px;">
                        <input type="checkbox" class="redpacket-type" value="拼手气红包" style="margin-right: 6px;">
                        拼手气红包
                    </label>
                    <label style="display: flex; align-items: center; font-size: 12px;">
                        <input type="checkbox" class="redpacket-type" value="普通红包" style="margin-right: 6px;">
                        普通红包
                    </label>
                    <label style="display: flex; align-items: center; font-size: 12px;">
                        <input type="checkbox" class="redpacket-type" value="专属红包" style="margin-right: 6px;">
                        专属红包
                    </label>
                    <label style="display: flex; align-items: center; font-size: 12px;">
                        <input type="checkbox" class="redpacket-type" value="心跳红包" style="margin-right: 6px;">
                        心跳红包
                    </label>
                    <label style="display: flex; align-items: center; font-size: 12px;">
                        <input type="checkbox" class="redpacket-type" value="猜拳红包" style="margin-right: 6px;">
                        猜拳红包
                    </label>
                    <label style="display: flex; align-items: center; font-size: 12px;">
                        <input type="checkbox" class="redpacket-type" value="石头剪刀布红包" style="margin-right: 6px;">
                        石头剪刀布红包
                    </label>
                </div>
            </div>
        </div>
        
        <div class="config-section" style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #333; font-size: 14px;">🎨 外观设置</h4>
            <!-- 新增背景颜色设置项 -->
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span>红包板块背景色:</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="backgroundColor" value="${CONFIG.backgroundColor}" 
                               style="width: 60px; height: 30px; padding: 2px; border: 1px solid #ddd; border-radius: 4px;">
                        <input type="text" id="backgroundColorText" value="${CONFIG.backgroundColor}"
                               style="width: 80px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;"
                               placeholder="#ffffff">
                    </div>
                </label>
            </div>
            <div class="config-item" style="margin-bottom: 10px;">
                <label style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span>面板位置:</span>
                    <select id="panelPosition" style="width: 120px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <option value="above">清风明月上方</option>
                        <option value="below">清风明月下方</option>
                    </select>
                </label>
            </div>
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
            <button id="applyConfig" style="flex: 1; padding: 10px; background: linear-gradient(135deg, #ff6b6b, #ff8e53); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
                保存并应用
            </button>
            <button id="resetConfig" style="flex: 1; padding: 10px; background: #f0f0f0; color: #666; border: none; border-radius: 6px; cursor: pointer;">
                恢复默认
            </button>
        </div>
        
        <div style="margin-top: 15px; font-size: 11px; color: #999; text-align: center;">
            配置将保存在本地，刷新页面后仍然有效
        </div>
    `;

        document.body.appendChild(configPanel);

        // 初始化配置表单
        initializeConfigForm();

        // 事件监听
        const closeBtn = configPanel.querySelector('#closeConfig');
        const applyBtn = configPanel.querySelector('#applyConfig');
        const resetBtn = configPanel.querySelector('#resetConfig');

        closeBtn.addEventListener('click', function() {
            configPanel.style.display = 'none';
        });

        applyBtn.addEventListener('click', applyConfig);

        resetBtn.addEventListener('click', resetConfig);

        // 点击外部关闭配置面板
        // configPanel.addEventListener('click', function(e) {
        //     if (e.target === configPanel) {
        //         configPanel.style.display = 'none';
        //     }
        // });

        // 添加配置按钮
        const floatingBtn = document.querySelector('.floating-window-btn');

        // 显示/隐藏配置面板
        window.toggleRedPacketConfig = function() {
            configPanel.style.display = configPanel.style.display === 'none' ? 'block' : 'none';
        };

        if (floatingBtn && floatingBtn.parentNode) {

            // 在原有配置按钮的样式基础上添加：
            const configBtn = document.createElement('button');
            configBtn.innerHTML = '⚙️';
            configBtn.title = '配置面板';
            configBtn.style.cssText = `
                width: 24px;
                height: 24px;
                border-radius: 50% !important;
                background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%) !important;
                color: white !important;
                font-size: 12px !important;
                cursor: pointer !important;
                border: 3px solid white !important;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-right: 5px;
                padding: 0;
                line-height: 1;
                box-shadow: 0 4px 15px rgba(108, 92, 231, 0.4) !important;
            `;

            configBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                window.toggleRedPacketConfig();
            });

            floatingBtn.parentNode.insertBefore(configBtn, floatingBtn);
        }

        const colorInput = document.getElementById('backgroundColor');
        const colorTextInput = document.getElementById('backgroundColorText');

        // 确保颜色输入框和文本框同步
        colorInput.addEventListener('input', function() {
            colorTextInput.value = colorInput.value;
        });

        colorTextInput.addEventListener('input', function() {
            if (isValidColor(colorTextInput.value)) {
                colorInput.value = colorTextInput.value;
            }
        });

        return configPanel;
    }


    // 初始化配置表单
    function initializeConfigForm() {
        // 显示设置
        document.getElementById('maxDisplayCount').value = CONFIG.maxDisplayCount;
        document.getElementById('visibleCount').value = CONFIG.visibleCount;
        document.getElementById('newMessageThreshold').value = CONFIG.newMessageThreshold;

        // 功能设置
        document.getElementById('autoScrollNew').checked = CONFIG.autoScrollNew;
        document.getElementById('monitorNewMessages').checked = CONFIG.monitorNewMessages;
        document.getElementById('autoDelRedPackets').checked = CONFIG.autoDelRedPackets;

        // 红包类型过滤
        document.getElementById('enableRedPacketFilter').checked = CONFIG.enableRedPacketFilter;
        document.getElementById('enableRedPacketModuleFilter').checked = CONFIG.enableRedPacketModuleFilter;

        // 设置选中的红包类型
        const typeCheckboxes = document.querySelectorAll('.redpacket-type');
        typeCheckboxes.forEach(checkbox => {
            checkbox.checked = CONFIG.filterRedPacketTypes.includes(checkbox.value);
        });

        // 外观设置
        document.getElementById('panelPosition').value = CONFIG.position;
        document.getElementById('backgroundColor').value = CONFIG.backgroundColor;
        document.getElementById('backgroundColorText').value = CONFIG.backgroundColor;
    }

    // 应用配置
    function applyConfig() {
        // 显示设置
        CONFIG.maxDisplayCount = parseInt(document.getElementById('maxDisplayCount').value) || 20;
        CONFIG.visibleCount = parseInt(document.getElementById('visibleCount').value) || 5;
        CONFIG.newMessageThreshold = parseInt(document.getElementById('newMessageThreshold').value) || 5;

        // 功能设置
        CONFIG.autoScrollNew = document.getElementById('autoScrollNew').checked;
        CONFIG.monitorNewMessages = document.getElementById('monitorNewMessages').checked;
        CONFIG.autoDelRedPackets = document.getElementById('autoDelRedPackets').checked;

        // 红包类型过滤
        CONFIG.enableRedPacketFilter = document.getElementById('enableRedPacketFilter').checked;
        CONFIG.enableRedPacketModuleFilter = document.getElementById('enableRedPacketModuleFilter').checked;
        CONFIG.filterRedPacketTypes = [];
        document.querySelectorAll('.redpacket-type:checked').forEach(checkbox => {
            CONFIG.filterRedPacketTypes.push(checkbox.value);
        });

        // 外观设置
        CONFIG.position = document.getElementById('panelPosition').value;
        const colorInput = document.getElementById('backgroundColor');
        const colorTextInput = document.getElementById('backgroundColorText');

        // 获取背景颜色值
        CONFIG.backgroundColor = isValidColor(colorTextInput.value) ?
            colorTextInput.value : colorInput.value;

        // 保存到localStorage
        saveConfigToStorage();

        // 更新面板样式
        updatePanelStyles();

        // 重新扫描红包
        if (RedPacketManager && typeof RedPacketManager.rescan === 'function') {
            RedPacketManager.rescan();
        }

        // 显示成功消息
        muliShowToast('配置已保存并应用');

        // 关闭配置面板
        const configPanel = document.querySelector('.red-packet-config');
        if (configPanel) {
            configPanel.style.display = 'none';
        }
    }

    // 新增：验证颜色格式的函数
    function isValidColor(color) {
        const s = new Option().style;
        s.color = color;
        return s.color !== '';
    }

    // 恢复默认配置
    function resetConfig() {
        // 默认配置
        const defaultConfig = {
            maxDisplayCount: 20,
            visibleCount: 5,
            refreshInterval: 10000,
            syncInterval: 1000,
            preserveOriginal: true,
            position: 'above',
            autoScrollNew: false,
            monitorNewMessages: true,
            newMessageThreshold: 5,
            autoDelRedPackets: false,
            enableRedPacketFilter: false,
            enableRedPacketModuleFilter: false,
            filterRedPacketTypes: [],
            backgroundColor: '#ffffff'
        };

        // 更新CONFIG
        Object.assign(CONFIG, defaultConfig);

        // 更新表单
        initializeConfigForm();

        // 保存到localStorage
        saveConfigToStorage();

        // 重新扫描红包
        if (RedPacketManager && typeof RedPacketManager.rescan === 'function') {
            RedPacketManager.rescan();
        }

        muliShowToast('已恢复默认配置');
    }

    // 保存配置到localStorage
    function saveConfigToStorage() {
        try {
            // 只保存必要的配置项
            const configToSave = {
                maxDisplayCount: CONFIG.maxDisplayCount,
                visibleCount: CONFIG.visibleCount,
                autoScrollNew: CONFIG.autoScrollNew,
                monitorNewMessages: CONFIG.monitorNewMessages,
                newMessageThreshold: CONFIG.newMessageThreshold,
                autoDelRedPackets: CONFIG.autoDelRedPackets,
                enableRedPacketFilter: CONFIG.enableRedPacketFilter,
                enableRedPacketModuleFilter: CONFIG.enableRedPacketModuleFilter,
                filterRedPacketTypes: CONFIG.filterRedPacketTypes,
                position: CONFIG.position,
                backgroundColor: CONFIG.backgroundColor
            };

            localStorage.setItem('redPacketConfig', JSON.stringify(configToSave));
            //console.log('配置已保存到localStorage');
        } catch (error) {
            //console.error('保存配置失败:', error);
        }
    }

    // 从localStorage加载配置
    function loadConfigFromStorage() {
        try {
            const savedConfig = localStorage.getItem('redPacketConfig');
            if (savedConfig) {
                const parsedConfig = JSON.parse(savedConfig);

                // 更新CONFIG
                Object.keys(parsedConfig).forEach(key => {
                    if (CONFIG.hasOwnProperty(key)) {
                        CONFIG[key] = parsedConfig[key];
                    }
                });

                //console.log('从localStorage加载配置成功');
                return true;
            }
        } catch (error) {
            //console.error('加载配置失败:', error);
        }
        return false;
    }

    // 更新面板样式
    function updatePanelStyles() {
        const redPacketBody = document.querySelector('.red-packet-body');
        if (redPacketBody) {
            redPacketBody.style.maxHeight = `${CONFIG.visibleCount * one_item_height}px`;
        }

        // 读取存储的浮窗状态和数据
        const redPacketIsFloatingWindow = localStorage.getItem('redPacketIsFloatingWindow');
        if (redPacketIsFloatingWindow) {
            if (redPacketIsFloatingWindow == 'true') {
                isFloatingWindow = true;
            } else if (redPacketIsFloatingWindow == 'false') {
                isFloatingWindow = false;
            }
        } else {
            isFloatingWindow = false;
        }
        const redPacketFloatingWindowData = localStorage.getItem('redPacketFloatingWindowData');
        if (redPacketFloatingWindowData) {
            floatingWindowData = JSON.parse(redPacketFloatingWindowData);
        }

        // 背景颜色
        const redPacketPanel = document.querySelector('.red-packet-module');
        if (redPacketPanel) {
            redPacketPanel.style.backgroundColor = CONFIG.backgroundColor;

            // 加载停靠还是浮窗状态
            setTimeout(() => {
                loadFloatingWindow(redPacketPanel);
            }, 500);

        }

    }

    // 配置面板的CSS样式（添加到addStyles函数中）
    const configStyles = `
        /* 配置面板样式 */
        .red-packet-config {
            animation: fadeIn 0.3s ease-out;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translate(-50%, -48%); }
            to { opacity: 1; transform: translate(-50%, -50%); }
        }
        
        .config-section {
            padding: 15px;
            background: #f9f9f9;
            border-radius: 8px;
            border-left: 4px solid #ff6b6b;
        }
        
        .config-item {
            transition: all 0.2s ease;
        }
        
        .config-item:hover {
            background: rgba(255, 107, 107, 0.05);
            padding: 4px 8px;
            border-radius: 4px;
        }
        
        input[type="number"]:focus,
        select:focus {
            outline: none;
            border-color: #ff6b6b !important;
            box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.2);
        }
        
        #applyConfig:hover {
            background: linear-gradient(135deg, #ff4757, #ff7b4a) !important;
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4) !important;
        }
        
        #resetConfig:hover {
            background: #e0e0e0 !important;
            transform: translateY(-1px);
        }
        
        /* 响应式调整 */
        @media (max-width: 480px) {
            .red-packet-config {
                width: 95vw;
                padding: 15px;
            }
            
            .config-section {
                padding: 12px;
            }
        }
    `;

    // 将配置样式添加到现有的样式表中
    const styleElement = document.createElement('style');
    styleElement.textContent = configStyles;
    document.head.appendChild(styleElement);

    setTimeout(createConfigPanel, 3000);

    /**
     * 消息提示
     * @param message
     * @param duration
     * @param type
     */
    function muliShowToast(message, duration = 2000, type = 'info') {
        const oldToast = document.getElementById('muli-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.id = 'muli-toast';
        toast.innerHTML = message;

        Object.assign(toast.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            color: 'white',
            padding: '14px 24px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '500',
            zIndex: '999999',
            textAlign: 'center',
            maxWidth: '80%',
            boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'all 0.3s ease'
        });

        const typeColors = {
            success: '#51cf66',
            info: '#339af0',
            warning: '#ff922b',
            error: '#ff6b6b'
        };
        toast.style.borderLeft = `4px solid ${typeColors[type] || typeColors.info}`;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translate(-50%, -50%) scale(1.05)';
        }, 10);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -50%) scale(0.95)';

            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, duration);
    }

    // 新增：CSS样式（添加到 addStyles 函数中）
    const minimizedStyles = `
        /* 最小化图标样式 */
        .red-packet-minimized-icon:hover {
            transform: scale(1.1);
            box-shadow: 0 8px 25px rgba(255, 107, 107, 0.6) !important;
        }
        
        .red-packet-minimized-icon:active {
            transform: scale(0.95);
        }
        
        /* 最小化图标闪烁动画 */
        @keyframes alertBlink {
            0%, 100% { 
                background: linear-gradient(135deg, #ff6b6b, #ff8e53);
                box-shadow: 0 6px 20px rgba(255, 107, 107, 0.5);
            }
            50% { 
                background: linear-gradient(135deg, #ff0000, #ff4757);
                box-shadow: 0 6px 20px rgba(255, 0, 0, 0.7);
            }
        }
        
        .red-packet-minimized-icon.alerting {
            animation: alertBlink 1.2s infinite;
        }
        
        /* 右键菜单样式 */
        .minimized-icon-context-menu {
            animation: fadeIn 0.2s ease-out;
        }
        
        .context-menu-item:hover {
            background-color: #f5f5f5;
        }
        
        /* 响应式调整 */
        @media (max-width: 768px) {
            .red-packet-minimized-icon {
                width: 50px;
                height: 50px;
                font-size: 24px;
                right: 20px !important;
                bottom: 80px !important;
            }
        }
    `;

    // 将最小化样式添加到现有的样式表中
    const minimizedStyleElement = document.createElement('style');
    minimizedStyleElement.textContent = minimizedStyles;
    document.head.appendChild(minimizedStyleElement);

    // 新增：在页面卸载前保存图标位置
    window.addEventListener('beforeunload', saveMinimizedIconPosition);

    // 新增：在窗口大小改变时调整图标位置
    window.addEventListener('resize', function() {
        if (minimizedIcon) {
            const rect = minimizedIcon.getBoundingClientRect();
            const maxX = window.innerWidth - minimizedIcon.offsetWidth;
            const maxY = window.innerHeight - minimizedIcon.offsetHeight;

            if (rect.left > maxX || rect.top > maxY) {
                minimizedIcon.style.left = Math.max(10, Math.min(rect.left, maxX)) + 'px';
                minimizedIcon.style.top = Math.max(10, Math.min(rect.top, maxY)) + 'px';
            }
        }
    });

    // 新增：初始化时检查是否应该显示最小化图标
    function checkInitialMinimizedState() {
        try {
            const savedMinimizedState = localStorage.getItem('redPacketMinimizedState');
            if (savedMinimizedState === 'true') {
                // 延迟执行，确保面板已创建
                setTimeout(() => {
                    toggleMinimizeMode();
                }, 500);
            }
        } catch (error) {
            console.error('检查最小化状态失败:', error);
        }
    }

})();
