// ============================================================================
// 事件記録ルーティングゲーム - メインロジック
// ============================================================================

const GRID_ROWS = 4;
const GRID_COLS = 4;
const DIRECTIONS = ['N', 'E', 'S', 'W'];
const DIRECTION_DELTAS = {
    'N': [-1, 0],
    'E': [0, 1],
    'S': [1, 0],
    'W': [0, -1]
};

const LINE_MOVE_SECONDS = 1.2; // 使わないが残置（後方互換）

// 難易度別の終盤加速設定
const SPEED_RAMP = {
    easy:   { base: 1.2, min: 0.95 },
    normal: { base: 1.05, min: 0.65 },
    hard:   { base: 0.95, min: 0.50 }
};

const START_DISPLAY_SECONDS = 1.2; // 事件係前で見せる秒数
const ENTRY_COOLDOWN_SECONDS = 0.4;

// 効果音（同ディレクトリに mp3 を置いてください）
const seCorrect = new Audio('se_correct.mp3');
const seWrong   = new Audio('se_wrong.mp3');
const seStart   = new Audio('se_start.mp3');

function playSE(audio) {
    if (!audio) return;
    try {
        audio.currentTime = 0;
        audio.play().catch(() => {});
    } catch (_) {}
}

// 部屋名定義（8部屋）
const ROOM_NAMES = {
    1: '第１室',
    2: '第２室',
    3: '第３室',
    4: '第４室',
    5: '第５室',
    6: '第６室',
    7: '第７室',
    8: '第８室'
};

// 難易度設定をゆっくりめに
const DIFFICULTY = {
    easy:   { tick_seconds: 1.2, max_tokens: 2, spawn_intervals: [9, 8, 7], arrow_init: 'biased' },
    normal: { tick_seconds: 1.0, max_tokens: 3, spawn_intervals: [8, 7, 6], arrow_init: 'random' },
    hard:   { tick_seconds: 0.9, max_tokens: 3, spawn_intervals: [7, 6, 5], arrow_init: 'biased' }
};

class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.difficulty = null;
        this.gameState = null;
        this.gameRunning = false;
        this.tokenId = 0;
        this.orientationWarning = document.getElementById('orientation-warning');

        // キャンバスサイズ設定
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        window.addEventListener('orientationchange', () => {
            this.resizeCanvas();
            this.checkOrientation();
        });

        this.checkOrientation();

        // UI要素
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.startGame(e.target.dataset.difficulty));
        });
        document.getElementById('restart-btn').addEventListener('click', () => this.resetGame());

        // キャンバスクリック/タッチ
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('touchstart', (e) => this.handleCanvasClick(e.touches[0]));

        this.lastFrameTime = null;    // 追加: RAF用
        this.difficultyKey = 'easy';
    }

    resizeCanvas() {
        const size = getCanvasSize();
        this.canvas.width = size.width;
        this.canvas.height = size.height;
        if (this.gameRunning) {
            this.render();
        }
    }

    checkOrientation() {
        const isLandscape = window.innerWidth > window.innerHeight;
        if (!isLandscape && this.gameRunning) {
            this.orientationWarning.style.display = 'flex';
        } else {
            this.orientationWarning.style.display = 'none';
        }
    }

    calculateLayout() {
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        
        const horizontalMargin = canvasWidth * 0.08;
        const verticalMargin = canvasHeight * 0.08;
        
        const usableWidth = canvasWidth - (horizontalMargin * 2);
        const usableHeight = canvasHeight - (verticalMargin * 2);

        const maxNodeSize = Math.min(
            usableWidth / GRID_COLS,
            usableHeight / GRID_ROWS
        );
        
        const nodeSize = Math.min(maxNodeSize, 60);

        const gridStartX = (canvasWidth - nodeSize * GRID_COLS) / 2;
        const gridStartY = (canvasHeight - nodeSize * GRID_ROWS) / 2;

        return {
            nodeSize,
            gridStartX,
            gridStartY,
            padding: nodeSize * 0.5,
            horizontalMargin,
            verticalMargin
        };
    }

    getNodePos(r, c) {
        const layout = this.calculateLayout();
        const x = layout.gridStartX + c * layout.nodeSize + layout.nodeSize / 2;
        const y = layout.gridStartY + r * layout.nodeSize + layout.nodeSize / 2;
        return { x, y };
    }

    // 事件係（スタート）の位置
    getStartPos() {
        const pos = this.getNodePos(1, 0);
        const layout = this.calculateLayout();
        return {
            x: Math.max(pos.x - layout.nodeSize * 1.8, layout.horizontalMargin * 0.7),
            y: pos.y
        };
    }

    // 部屋の位置と名前を取得
    getRoomInfo(roomNum) {
        const layout = this.calculateLayout();
        const padding = layout.padding;
        const endNodePos = this.getNodePos(3, 3);
        const nodeSize = layout.nodeSize;

        let pos = {};
        let label = ROOM_NAMES[roomNum] || `部屋${roomNum}`;

        if (roomNum <= 4) {
            // 右側の部屋（1～4）
            const roomIndex = roomNum - 1;
            const startY = this.getNodePos(0, 3).y;
            pos.x = endNodePos.x + padding + 30;
            pos.y = startY + roomIndex * nodeSize;
        } else {
            // 下側の部屋（5～8）
            const roomIndex = roomNum - 5;
            const startX = this.getNodePos(3, 0).x;
            pos.x = startX + roomIndex * nodeSize;
            pos.y = endNodePos.y + padding + 30;
        }

        return { pos, label };
    }

    startGame(difficulty) {
        this.difficultyKey = difficulty;
        this.difficulty = DIFFICULTY[difficulty];
        document.getElementById('difficulty-select').style.display = 'none';
        this.gameRunning = true;
        this.checkOrientation();

        this.gameState = {
            score: 0,
            life: 3,
            timeLeft: 60,
            combo: 0,
            outsideQueue: [],
            tokensInGrid: [],
            grid: this.initializeGrid(),
            lastSpawnTime: 0,
            spawnInterval: this.difficulty.spawn_intervals[0],
            elapsedTime: 0,
            correctCount: 0,
            wrongCount: 0,
            stuckCount: 0,
            maxCombo: 0,
            countdownActive: true,
            countdownValue: 3,
            countdownTimer: 0
        };
        // 最初のトークンを必ず事件係前に出す
        this.enqueueToken();

        this.lastFrameTime = null;
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    initializeGrid() {
        const grid = [];
        for (let r = 0; r < GRID_ROWS; r++) {
            const row = [];
            for (let c = 0; c < GRID_COLS; c++) {
                const validDirections = this.getValidDirections(r, c);
                let currentDir;
                if (this.difficulty.arrow_init === 'biased') {
                    currentDir = this.getOutletBiasedDirection(r, c, validDirections);
                } else {
                    currentDir = validDirections[Math.floor(Math.random() * validDirections.length)];
                }
                row.push({ validDirections, currentDirection: currentDir });
            }
            grid.push(row);
        }
        return grid;
    }

    getValidDirections(r, c) {
        const valid = [];
        if (r > 0) valid.push('N');
        if (c < GRID_COLS - 1) valid.push('E');
        if (r < GRID_ROWS - 1) valid.push('S');
        if (c > 0) valid.push('W');
        return valid;
    }

    getOutletBiasedDirection(r, c, validDirs) {
        const outletBiased = [];
        if (c === GRID_COLS - 1) outletBiased.push('E');
        if (r === GRID_ROWS - 1) outletBiased.push('S');

        if (outletBiased.length > 0 && Math.random() < 0.8) {
            return outletBiased[0];
        }

        return validDirs[Math.floor(Math.random() * validDirs.length)];
    }

    gameLoop(timestamp) {
        if (!this.gameRunning) return;
        if (!this.lastFrameTime) this.lastFrameTime = timestamp;
        const deltaSec = Math.min(0.05, (timestamp - this.lastFrameTime) / 1000); // 最大50ms
        this.lastFrameTime = timestamp;

        this.updateGame(deltaSec);
        this.render();

        if (this.gameRunning) {
            requestAnimationFrame((t) => this.gameLoop(t));
        }
    }

    updateGame(deltaSec) {
        // カウントダウン中は時間・スポーン・移動を止める
        if (this.gameState.countdownActive) {
            this.gameState.countdownTimer += deltaSec;
            if (this.gameState.countdownTimer >= 1) {
                this.gameState.countdownTimer = 0;
                this.gameState.countdownValue -= 1;
                if (this.gameState.countdownValue <= 0) {
                    playSE(seStart); // カウントダウン終了音
                    this.gameState.countdownActive = false;
                    // カウント終了後に経過時間とスポーン計測をリセット
                    this.gameState.elapsedTime = 0;
                    this.gameState.lastSpawnTime = 0;
                }
            }
            // ヘッダー表示はこのまま更新
            document.getElementById('score').textContent = this.gameState.score;
            document.getElementById('time').textContent = Math.ceil(this.gameState.timeLeft);
            document.getElementById('life').textContent = '❤'.repeat(Math.max(0, this.gameState.life));
            return;
        }

        this.gameState.elapsedTime += deltaSec;
        this.gameState.timeLeft = Math.max(0, 60 - this.gameState.elapsedTime);

        if (this.gameState.elapsedTime >= 40) {
            this.gameState.spawnInterval = this.difficulty.spawn_intervals[2];
        } else if (this.gameState.elapsedTime >= 20) {
            this.gameState.spawnInterval = this.difficulty.spawn_intervals[1];
        }

        this.gameState.lastSpawnTime += deltaSec;
        if (this.gameState.lastSpawnTime >= this.gameState.spawnInterval) {
            if ((this.gameState.outsideQueue.length + this.gameState.tokensInGrid.length) < this.difficulty.max_tokens) {
                this.enqueueToken();
            }
            this.gameState.lastSpawnTime = 0;
        }

        // スタート待機→侵入
        for (let i = this.gameState.outsideQueue.length - 1; i >= 0; i--) {
            const token = this.gameState.outsideQueue[i];
            if (token.displayAtStart) {
                token.displayDuration -= deltaSec;
                if (token.displayDuration > 0) continue;
                token.displayAtStart = false;
                continue; // このフレームでは入れない
            }
            if (token.entryCooldown > 0) {
                token.entryCooldown -= deltaSec;
                continue;
            }
            if (this.canEnterGrid(token)) {
                token.state = 'IN_GRID';
                token.currentR = 1;
                token.currentC = 0;
                token.moveStage = 0;
                token.moveProgress = 0;
                token.nextR = null;
                token.nextC = null;
                this.gameState.tokensInGrid.push(token);
                this.gameState.outsideQueue.splice(i, 1);
            }
        }

        this.gameState.tokensInGrid.sort((a, b) => a.spawnOrder - b.spawnOrder);

        const toRemove = [];
        for (const token of this.gameState.tokensInGrid) {
            if (token.moveStage === 0) {
                if (token.nextR === null) {
                    const nextPos = this.getNextPosition(token.currentR, token.currentC, this.gameState.grid);
                    if (nextPos.room) {
                        if (nextPos.room === token.number) {
                            this.gameState.combo++;
                            this.gameState.maxCombo = Math.max(this.gameState.maxCombo, this.gameState.combo);
                            const bonusScore = Math.min(this.gameState.combo, 5);
                            this.gameState.score += 10 + bonusScore;
                            this.gameState.correctCount++;
                            this.showFeedback(`正配！ +${10 + bonusScore}点`, 'correct');
                        } else {
                            this.gameState.score -= 5;
                            this.gameState.life--;
                            this.gameState.combo = 0;
                            this.gameState.wrongCount++;
                            this.showFeedback('誤配！ -5点', 'wrong');
                        }
                        toRemove.push(token.id);
                        continue;
                    } else if (nextPos.r !== null && !this.isNodeOccupied(nextPos.r, nextPos.c)) {
                        token.nextR = nextPos.r;
                        token.nextC = nextPos.c;
                        token.moveSteps++;
                        token.stuckTime = 0;
                        token.moveStage = 1;
                        token.moveProgress = 0;
                    } else {
                        token.stuckTime += deltaSec;
                    }
                }
            } else if (token.moveStage === 1) {
                const lineSec = this.getLineMoveSeconds();
                token.moveProgress += deltaSec / lineSec;
                if (token.moveProgress >= 1.0) {
                    token.moveProgress = 0;
                    token.moveStage = 2;
                }
            } else if (token.moveStage === 2) {
                token.currentR = token.nextR;
                token.currentC = token.nextC;
                token.nextR = null;
                token.nextC = null;
                token.moveStage = 0;
                token.moveProgress = 0;
            }

            if (token.moveSteps + token.stuckTime > 30 || token.stuckTime >= 8) {
                this.gameState.score -= 3;
                this.gameState.life--;
                this.gameState.combo = 0;
                this.gameState.stuckCount++;
                this.showFeedback('滞留（混雑）-3点', 'stuck');
                toRemove.push(token.id);
            }
        }

        this.gameState.tokensInGrid = this.gameState.tokensInGrid.filter(t => !toRemove.includes(t.id));

        if (this.gameState.life <= 0 || this.gameState.timeLeft <= 0) {
            this.endGame();
        }

        document.getElementById('score').textContent = this.gameState.score;
        document.getElementById('time').textContent = Math.ceil(this.gameState.timeLeft);
        document.getElementById('life').textContent = '❤'.repeat(Math.max(0, this.gameState.life));
    }

    canEnterGrid(token) {
        return !this.isNodeOccupied(1, 0);
    }

    isNodeOccupied(r, c) {
        return this.gameState.tokensInGrid.some(t =>
            (t.moveStage === 0 && t.currentR === r && t.currentC === c) ||
            ((t.moveStage === 1 || t.moveStage === 2) && t.nextR === r && t.nextC === c)
        );
    }

    getNextPosition(r, c, grid) {
        const dir = grid[r][c].currentDirection;
        const delta = DIRECTION_DELTAS[dir];

        if (!delta) return { r: null, c: null };

        const nextR = r + delta[0];
        const nextC = c + delta[1];

        // 部屋判定（4列目と3行目）
        if (c === 3 && r < 4) {
            if (dir === 'E') return { room: 1 + r };
        }
        if (r === 3 && c < 4) {
            if (dir === 'S') return { room: 5 + c };
        }

        // グリッド内
        if (nextR >= 0 && nextR < GRID_ROWS && nextC >= 0 && nextC < GRID_COLS) {
            return { r: nextR, c: nextC };
        }

        return { r: null, c: null };
    }

    handleCanvasClick(e) {
        if (!this.gameRunning) return;

        const rect = this.canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const layout = this.calculateLayout();

        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const pos = this.getNodePos(r, c);
                const dist = Math.hypot(clickX - pos.x, clickY - pos.y);
                if (dist < layout.nodeSize / 2.5) {
                    this.rotateArrow(r, c);
                    return;
                }
            }
        }
    }

    rotateArrow(r, c) {
        const cell = this.gameState.grid[r][c];
        const dirs = ['N', 'E', 'S', 'W'];

        const currentIndex = dirs.indexOf(cell.currentDirection);
        const nextIndex = (currentIndex + 1) % dirs.length;
        cell.currentDirection = dirs[nextIndex];
    }

    showFeedback(message, type) {
        const feedback = document.getElementById('feedback');
        feedback.textContent = message;
        feedback.className = `feedback ${type}`;
        if (type === 'correct') playSE(seCorrect);
        if (type === 'wrong' || type === 'stuck') playSE(seWrong);
        setTimeout(() => {
            feedback.textContent = '';
            feedback.className = '';
        }, 1000);
    }

    endGame() {
        this.gameRunning = false;
        this.orientationWarning.style.display = 'none';
        const resultScreen = document.getElementById('result-screen');
        const resultContent = document.getElementById('result-content');
        resultContent.innerHTML = `
            <p>スコア: <strong>${this.gameState.score}</strong></p>
            <p>正配: ${this.gameState.correctCount} | 誤配: ${this.gameState.wrongCount} | 滞留: ${this.gameState.stuckCount}</p>
            <p>最大コンボ: ${this.gameState.maxCombo}</p>
        `;
        resultScreen.style.display = 'flex';
    }

    resetGame() {
        document.getElementById('result-screen').style.display = 'none';
        document.getElementById('difficulty-select').style.display = 'block';
        this.orientationWarning.style.display = 'none';
        document.getElementById('score').textContent = '0';
        document.getElementById('time').textContent = '60';
        document.getElementById('life').textContent = '❤❤❤';
        this.gameState = null;
        this.render();
    }

    enqueueToken() {
        const tokenNum = Math.floor(Math.random() * 8) + 1;
        this.gameState.outsideQueue.push({
            id: this.tokenId++,
            number: tokenNum,
            state: 'OUTSIDE',
            moveSteps: 0,
            stuckTime: 0,
            spawnOrder: this.tokenId,
            displayAtStart: true,
            displayDuration: START_DISPLAY_SECONDS,
            entryCooldown: ENTRY_COOLDOWN_SECONDS,
            moveStage: 0,
            moveProgress: 0,
            currentR: null,
            currentC: null,
            nextR: null,
            nextC: null
        });
    }

    render() {
        const ctx = this.ctx;
        const layout = this.calculateLayout();

        // 背景
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // グリッド線
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        for (let r = 0; r <= GRID_ROWS; r++) {
            const pos1 = this.getNodePos(r, 0);
            const pos2 = this.getNodePos(r, GRID_COLS - 1);
            ctx.beginPath();
            ctx.moveTo(pos1.x, pos1.y);
            ctx.lineTo(pos2.x, pos2.y);
            ctx.stroke();
        }
        for (let c = 0; c <= GRID_COLS; c++) {
            const pos1 = this.getNodePos(0, c);
            const pos2 = this.getNodePos(GRID_ROWS - 1, c);
            ctx.beginPath();
            ctx.moveTo(pos1.x, pos1.y);
            ctx.lineTo(pos2.x, pos2.y);
            ctx.stroke();
        }

        // ノード
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const pos = this.getNodePos(r, c);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, layout.nodeSize / 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        // 事件係ラベル
        const startPos = this.getStartPos();
        ctx.fillStyle = '#333';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('事件係', startPos.x, startPos.y - 25);
        ctx.font = '11px sans-serif';
        ctx.fillText('START', startPos.x, startPos.y + 25);

        // 待機中トークン（事件係前）
        if (this.gameState) {
            const queueDisplayCount = Math.min(4, this.gameState.outsideQueue.length);
            for (let i = 0; i < queueDisplayCount; i++) {
                const token = this.gameState.outsideQueue[i];
                const offsetX = (i - (queueDisplayCount - 1) / 2) * 32;
                const displayX = startPos.x + offsetX;
                const displayY = startPos.y;
                const radius = token.displayAtStart ? layout.nodeSize / 5.5 : layout.nodeSize / 6.5;
                const color = token.displayAtStart ? '#ff9800' : '#2196f3';

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(displayX, displayY, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(token.number, displayX, displayY);
            }
        }

        // グリッド内トークン（ステージ別描画）
        if (this.gameState) {
            for (const token of this.gameState.tokensInGrid) {
                let displayX, displayY;
                if (token.moveStage === 0) {
                    const pos = this.getNodePos(token.currentR, token.currentC);
                    displayX = pos.x; displayY = pos.y;
                } else if (token.moveStage === 1) {
                    const s = this.getNodePos(token.currentR, token.currentC);
                    const e = this.getNodePos(token.nextR, token.nextC);
                    displayX = s.x + (e.x - s.x) * token.moveProgress;
                    displayY = s.y + (e.y - s.y) * token.moveProgress;
                } else {
                    const pos = this.getNodePos(token.nextR, token.nextC);
                    displayX = pos.x; displayY = pos.y;
                }

                ctx.fillStyle = '#4caf50';
                ctx.beginPath();
                ctx.arc(displayX, displayY, layout.nodeSize / 5.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(token.number, displayX, displayY);
            }
        }

        // 部屋表示
        for (let room = 1; room <= 8; room++) {
            const roomInfo = this.getRoomInfo(room);
            const pos = roomInfo.pos;
            const boxWidth = 65;
            const boxHeight = 28;

            ctx.fillStyle = '#e8f5e9';
            ctx.strokeStyle = '#4caf50';
            ctx.lineWidth = 1.5;
            ctx.fillRect(pos.x - boxWidth / 2, pos.y - boxHeight / 2, boxWidth, boxHeight);
            ctx.strokeRect(pos.x - boxWidth / 2, pos.y - boxHeight / 2, boxWidth, boxHeight);

            ctx.fillStyle = '#333';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(room, pos.x, pos.y - 5);
            ctx.font = '8px sans-serif';
            ctx.fillText(roomInfo.label, pos.x, pos.y + 6);
        }

        // 矢印を最後に重ねて描画（トークンと重なっても見える）
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = this.gameState.grid[r][c];
                const pos = this.getNodePos(r, c);
                this.drawArrow(pos.x, pos.y, cell.currentDirection, layout.nodeSize / 5.5);
                this.drawDirectionIndicator(pos.x, pos.y, cell.currentDirection, layout.nodeSize / 6);
            }
        }

        // カウントダウン表示（中央）
        if (this.gameState && this.gameState.countdownActive) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${layout.nodeSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.gameState.countdownValue, this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    drawArrow(x, y, direction, size) {
        const ctx = this.ctx;
        ctx.strokeStyle = '#666';
        ctx.fillStyle = '#666';
        ctx.lineWidth = 2;

        const angles = {
            'N': -Math.PI / 2,
            'E': 0,
            'S': Math.PI / 2,
            'W': Math.PI
        };

        const angle = angles[direction];
        const arrowX = x + Math.cos(angle) * size * 0.8;
        const arrowY = y + Math.sin(angle) * size * 0.8;

        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(x - Math.cos(angle) * size * 0.3, y - Math.sin(angle) * size * 0.3);
        ctx.stroke();

        const headSize = size * 0.5;
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - Math.cos(angle + Math.PI / 6) * headSize, 
                   arrowY - Math.sin(angle + Math.PI / 6) * headSize);
        ctx.lineTo(arrowX - Math.cos(angle - Math.PI / 6) * headSize, 
                   arrowY - Math.sin(angle - Math.PI / 6) * headSize);
        ctx.closePath();
        ctx.fill();
    }

    drawDirectionIndicator(x, y, direction, size) {
        const ctx = this.ctx;
        ctx.strokeStyle = '#ff6b6b';
        ctx.fillStyle = '#ff6b6b';
        ctx.lineWidth = 1.5;

        const angles = {
            'N': -Math.PI / 2,
            'E': 0,
            'S': Math.PI / 2,
            'W': Math.PI
        };

        const angle = angles[direction];
        const startX = x + Math.cos(angle) * size * 0.6;
        const startY = y + Math.sin(angle) * size * 0.6;
        const endX = x + Math.cos(angle) * size * 1.2;
        const endY = y + Math.sin(angle) * size * 1.2;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        const headSize = size * 0.35;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - Math.cos(angle + Math.PI / 6) * headSize, 
                   endY - Math.sin(angle + Math.PI / 6) * headSize);
        ctx.lineTo(endX - Math.cos(angle - Math.PI / 6) * headSize, 
                   endY - Math.sin(angle - Math.PI / 6) * headSize);
        ctx.closePath();
        ctx.fill();
    }

    getLineMoveSeconds() {
        const cfg = SPEED_RAMP[this.difficultyKey] || SPEED_RAMP.normal;
        const base = cfg.base;
        const min  = cfg.min;
        const progress = Math.min(1, this.gameState ? (this.gameState.elapsedTime / 60) : 0);
        return base - (base - min) * progress; // 終盤ほど速く
    }
}

function getCanvasSize() {
    const sidebar = document.getElementById('sidebar');
    const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().width : 0;
    const width = Math.max(320, window.innerWidth - sidebarWidth);
    const height = window.innerHeight;
    return { width, height };
}

window.addEventListener('DOMContentLoaded', () => {
    new Game();
});
