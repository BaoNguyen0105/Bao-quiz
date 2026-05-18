const API_BASE = '/api';

let sessionState = {
    currentQuizId: null,
    questions: [],
    activeIndex: 0,
    config: { randomizeQ: false, randomizeA: false, immediateMode: true },
    userSelections: {}, 
    lockedQuestions: {} // Holds response validation payloads returned securely from the database
};

// Run immediately upon browser execution window load
window.addEventListener('DOMContentLoaded', fetchAndRenderQuizDirectory);

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`).classList.add('active');
    document.getElementById('runtime-status').innerText = pageId === 'main' ? 'Main Desk' : 'Active Practice Session';
}

// 1. GET /api/quizzes -> Pull real quizzes from MySQL via Node.js
async function fetchAndRenderQuizDirectory() {
    const listContainer = document.getElementById('quiz-list-target');
    try {
        const response = await fetch(`${API_BASE}/quizzes`);
        const quizzes = await response.json();

        if (quizzes.length === 0) {
            listContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 1rem;">No quizzes found in database. Upload a file to get started!</p>';
            return;
        }

        listContainer.innerHTML = '';
        quizzes.forEach(quiz => {
            const item = document.createElement('div');
            item.className = 'quiz-item';
            item.innerHTML = `
                <div>
                    <strong>${quiz.title}</strong><br>
                    <small style="color: var(--text-muted);">Added: ${new Date(quiz.created_at).toLocaleDateString()}</small>
                </div>
                <div class="quiz-actions">
                    <button class="btn-start" onclick="initiateQuizSessionSetup(${quiz.id})">Configure & Launch</button>
                    <button class="btn-delete" onclick="deleteQuizRecord(${quiz.id})">Delete</button>
                </div>
            `;
            listContainer.appendChild(item);
        });
    } catch (error) {
        listContainer.innerHTML = `<p style="color: var(--incorrect);">Failed to connect to backend server framework.</p>`;
    }
}

// 2. GET /api/quiz/:id -> Fetch complete quiz layout tree
async function initiateQuizSessionSetup(quizId) {
    try {
        document.body.style.cursor = 'wait';
        const response = await fetch(`${API_BASE}/quiz/${quizId}`);
        if (!response.ok) throw new Error('Could not retrieve quiz parameters.');
        const quizData = await response.json();

        // Capture Session Toggles
        sessionState.config.randomizeQ = document.getElementById('cfg-rand-q').checked;
        sessionState.config.randomizeA = document.getElementById('cfg-rand-a').checked;
        sessionState.config.immediateMode = document.querySelector('input[name="cfg-feedback"]:checked').value === 'per-q';

        let rawDataSet = quizData.questions;

        // Handle client-side shuffle configurations
        if (sessionState.config.randomizeQ) rawDataSet.sort(() => Math.random() - 0.5);
        if (sessionState.config.randomizeA) {
            rawDataSet.forEach(q => q.options.sort(() => Math.random() - 0.5));
        }

        // Reset runtime states
        sessionState.currentQuizId = quizId;
        sessionState.questions = rawDataSet;
        sessionState.activeIndex = 0;
        sessionState.userSelections = {};
        sessionState.lockedQuestions = {};

        generateNavigationMatrix();
        renderActiveQuestionCanvas();
        switchPage('quiz');
        document.body.style.cursor = 'auto';
    } catch (err) {
        document.body.style.cursor = 'auto';
        alert(`Error initializing practice session: ${err.message}`);
    }
}

function generateNavigationMatrix() {
    const container = document.getElementById('matrix-target');
    container.innerHTML = '';
    sessionState.questions.forEach((q, index) => {
        const cell = document.createElement('div');
        cell.className = 'matrix-cell';
        cell.innerText = index + 1;
        cell.id = `matrix-cell-${index}`;
        cell.onclick = () => jumpToQuestionIndex(index);
        container.appendChild(cell);
    });
    updateMatrixHighlightStyles();
}

function updateMatrixHighlightStyles() {
    sessionState.questions.forEach((q, index) => {
        const cell = document.getElementById(`matrix-cell-${index}`);
        if (!cell) return;
        cell.className = 'matrix-cell';
        if (index === sessionState.activeIndex) cell.classList.add('active');
        if (sessionState.userSelections[q.id] !== undefined) cell.classList.add('answered');
    });
}

function renderActiveQuestionCanvas() {
    if (sessionState.questions.length === 0) return;
    const currentQuestion = sessionState.questions[sessionState.activeIndex];
    
    document.getElementById('canvas-question-text').innerText = `${sessionState.activeIndex + 1}. ${currentQuestion.question_text}`;
    
    // Render Images from production static pathing map
    const gallery = document.getElementById('canvas-image-gallery');
    gallery.innerHTML = '';
    currentQuestion.images.forEach(src => {
        const img = document.createElement('img');
        // If it's a relative path stored locally, append server prefix address
        img.src = src.startsWith('http') ? src : `http://127.0.0.1:3000${src}`;
        img.className = 'quiz-image';
        gallery.appendChild(img);
    });

    // Options Choice Nodes Rendering
    const optionsBox = document.getElementById('canvas-options-box');
    optionsBox.innerHTML = '';
    
    const isLocked = sessionState.lockedQuestions[currentQuestion.id] !== undefined;

    currentQuestion.options.forEach(opt => {
        const node = document.createElement('div');
        node.className = 'option-node';
        node.innerText = opt.option_text;

        if (isLocked) {
            node.classList.add('disabled');
            const correctId = sessionState.lockedQuestions[currentQuestion.id].correct_id;
            if (opt.id === correctId) node.classList.add('correct');
            if (sessionState.userSelections[currentQuestion.id] === opt.id && opt.id !== correctId) {
                node.classList.add('incorrect');
            }
        } else {
            if (sessionState.userSelections[currentQuestion.id] === opt.id) node.classList.add('selected');
            node.onclick = () => selectOptionChoice(currentQuestion.id, opt.id);
        }
        optionsBox.appendChild(node);
    });

    document.getElementById('btn-prev').disabled = sessionState.activeIndex === 0;
    document.getElementById('btn-next').disabled = sessionState.activeIndex === sessionState.questions.length - 1;
    
    if (sessionState.config.immediateMode) {
        document.getElementById('btn-check').style.display = 'block';
        document.getElementById('btn-check').disabled = isLocked || sessionState.userSelections[currentQuestion.id] === undefined;
        document.getElementById('btn-submit-quiz').style.display = 'none';
    } else {
        document.getElementById('btn-check').style.display = 'none';
        const isLastQuestion = sessionState.activeIndex === sessionState.questions.length - 1;
        document.getElementById('btn-submit-quiz').style.display = isLastQuestion ? 'block' : 'none';
    }
    updateMatrixHighlightStyles();
}

function selectOptionChoice(questionId, optionId) {
    sessionState.userSelections[questionId] = optionId;
    renderActiveQuestionCanvas();
}

function jumpToQuestionIndex(index) {
    sessionState.activeIndex = index;
    renderActiveQuestionCanvas();
}

function stepActiveIndex(direction) {
    let nextTarget = sessionState.activeIndex + direction;
    if (nextTarget >= 0 && nextTarget < sessionState.questions.length) {
        sessionState.activeIndex = nextTarget;
        renderActiveQuestionCanvas();
    }
}

// 3. GET /api/question/:id/check -> Validate a single option choice choice instantly
async function evaluateActiveQuestionImmediate() {
    const currentQuestion = sessionState.questions[sessionState.activeIndex];
    const selectedId = sessionState.userSelections[currentQuestion.id];

    try {
        const response = await fetch(`${API_BASE}/question/${currentQuestion.id}/check?selected_option_id=${selectedId}`);
        const data = await response.json();
        
        // Store the verification signature returned securely from MySQL 
        sessionState.lockedQuestions[currentQuestion.id] = { correct_id: data.correct_option_id };
        renderActiveQuestionCanvas();
    } catch (err) {
        alert('Error grading question item response.');
    }
}

// 4. POST /api/quiz/:id/submit -> Bulk evaluate answers at the end of execution
async function compileAndSubmitAll() {
    // Translate tracking object payload map to structured database JSON array
    const formattedAnswers = Object.keys(sessionState.userSelections).map(qId => ({
        id: parseInt(qId), // Matches key tracking mapping array structure
        question_id: parseInt(qId),
        selected_option_id: sessionState.userSelections[qId]
    }));

    try {
        const response = await fetch(`${API_BASE}/quiz/${sessionState.currentQuizId}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: formattedAnswers })
        });
        const evaluationResult = await response.json();

        // Extract calculations directly out of our node payload response object
        document.getElementById('results-score').innerText = evaluationResult.score;
        document.getElementById('results-total').innerText = evaluationResult.total_questions;
        
        const ratio = evaluationResult.total_questions > 0 ? (evaluationResult.score / evaluationResult.total_questions) * 100 : 0;
        document.getElementById('results-percentage').innerText = `${Math.round(ratio)}%`;

        switchPage('results');
    } catch (err) {
        alert('Failed to transmit bulk execution parameters to database engine.');
    }
}

// 5. POST /api/quiz/upload -> Multi-part form stream ingestion engine boundary upload
async function handleBulkUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Prompt user directly for title structure parameter binding tracking
    const quizTitleInput = prompt("Enter a descriptive title for this practice quiz dataset:", file.name.split('.')[0]);
    if (quizTitleInput === null) return; // Action aborted by user

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', quizTitleInput || file.name.split('.')[0]);

    try {
        const response = await fetch(`${API_BASE}/quiz/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorBody = await response.json().catch(() => null);
            const errorMessage = errorBody?.error || errorBody?.message || 'Data structure serialization failure format.';
            throw new Error(errorMessage);
        }
        
        alert('File uploaded and database transaction fully committed successfully.');
        event.target.value = ''; // Flush pointer file node item clean
        fetchAndRenderQuizDirectory();
    } catch (err) {
        alert(`Upload failed: ${err.message}`);
    }
}

// 6. DELETE /api/quiz/:id -> Delete a practice quiz entirely
async function deleteQuizRecord(quizId) {
    if (!confirm("Are you sure you want to permanently delete this quiz and all its questions/images?")) return;

    try {
        const response = await fetch(`${API_BASE}/quiz/${quizId}`, { method: 'DELETE' });
        if (response.ok) {
            fetchAndRenderQuizDirectory();
        }
    } catch (err) {
        alert('Failed to execute deletion cascade script sequence.');
    }
}

function abortSessionToMain() {
    switchPage('main');
}

function toggleFormatInstructions() {
    const box = document.getElementById('format-instructions-box');
    if (box.style.display === 'none') {
        box.style.display = 'block';
    } else {
        box.style.display = 'none';
    }
}