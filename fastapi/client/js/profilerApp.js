/**
 * Main application module for the profiler interface.
 * Handles questionnaire flow, user responses, and profile management.
 * @returns {Object} Alpine.js component definition
 */
function profilerApp() {
    return {
        // State properties
        groupToken: new URLSearchParams(window.location.search).get('groupToken'),
        groupDisplayAs: '',
        profile: { id: null, token: null, name: '' },
        questions: [],
        options: [],
        answers: {},
        modal: { active: false, message: '', showX: true },
        debounceTimeout: null,
        currentQuestion: 0,
        showSkip: false,

        // Teacher-responder mode properties
        responderType: new URLSearchParams(window.location.search).get('responderType'),
        teacherProfileId: new URLSearchParams(window.location.search).get('profileId'),
        isTeacherResponder: false,

        /**
         * Get total number of questions including name input and submit button
         * @returns {number} Total question count plus 2
         */
        get totalQuestions() {
            return this.questions.length + 2;
        },

        /**
         * Navigate to previous question
         */
        prevQuestion() {
            if (this.currentQuestion > 0) {
                this.currentQuestion--;
            }
        },

        /**
         * Navigate to next question
         */
        nextQuestion() {
            if (this.currentQuestion < this.totalQuestions - 1) {
                this.currentQuestion++;
            }
        },

        /**
         * Validation state object
         */
        validation: {
            validating: false,
            fields: { name_blank: true, questions_unanswered: true },
            get show() {
                if (this.validating) {
                    if (!Object.values(this.fields).some(value => value)) {
                        this.validating = false;
                        return false;
                    }
                    return true;
                }
                return false;
            }
        },

        /**
         * Skip to next unanswered question
         */
        skipAnswered() {
            if (this.unansweredQuestions.length > 0) {
                const nextUnanswered = this.unansweredQuestions.find(q => q > this.currentQuestion - 1);
                this.currentQuestion = nextUnanswered !== undefined ? nextUnanswered + 1 : this.totalQuestions - 1;
            } else {
                this.currentQuestion = this.totalQuestions - 1;
            }
        },

        /**
         * Initialize the application
         */
        async init() {
            // Check if this is teacher-responder mode (profileId + responderType in URL)
            if (this.teacherProfileId && this.responderType) {
                this.isTeacherResponder = true;
                await this.initTeacherResponderMode();
                return;
            }

            // Watch for name changes
            this.$watch('profile.name', value => {
                this.$nextTick(() => {
                    this.validation.fields.name_blank = (value == '');
                });
            });

            // Watch for question changes to handle skip button visibility
            this.$watch('currentQuestion', value => {
                this.showSkip = false;
                this.$nextTick(() => {
                    sleep(1000).then(() => {
                        if (this.currentQuestion === value) {
                            const qIndex = this.currentQuestion - 1;
                            if (this.questions[qIndex] in this.answers) {
                                this.showSkip = true;
                            }
                        }
                    });
                });
            });

            if (!this.groupToken) {
                this.showModal('Group token is required in the query string.');
                return;
            }

            // Load existing profile or create new one
            const storedData = localStorage.getItem(this.groupToken);
            if (storedData) {
                const { id, profileToken } = JSON.parse(storedData);
                this.profile.id = id;
                this.profile.token = profileToken;
                await this.loadProfile();
            } else {
                await this.createProfile();
            }

            // Set initial question based on completion state
            await this.$nextTick(() => {
                if (this.validation.fields.name_blank) {
                    this.currentQuestion = 0;
                } else if (this.unansweredQuestions.length > 0) {
                    this.currentQuestion = this.unansweredQuestions[0] + 1;
                } else {
                    this.currentQuestion = this.totalQuestions - 1;
                }
            });
        },

        /**
         * Create a new profile
         */
        async createProfile() {
            try {
                const response = await fetch('/api/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupToken: this.groupToken }),
                });
                if (!response.ok) throw new Error('Failed to create profile. Your URL might be incorrect.');
                
                const data = await response.json();
                this.profile.id = data.id;
                this.profile.token = data.profileToken;
                this.groupDisplayAs = data.groupDisplayAs;
                localStorage.setItem(this.groupToken, JSON.stringify(data));
                await this.loadQuestions(data.profilerTypeName);
            } catch (error) {
                this.showModal(error.message);
                console.error(error);
            }
        },

        /**
         * Load profile data
         */
        async loadProfile() {
            try {
                const response = await fetch(`/api/profile/${this.profile.id}?profileToken=${this.profile.token}`);
                if (!response.ok) throw new Error('Failed to load profile.');
                
                const data = await response.json();
                this.profile.name = data.name;
                this.groupDisplayAs = data.groupDisplayAs;
                for (const answer of data.answers) {
                    this.answers[answer.question] = answer.score;
                }
                await this.loadQuestions(data.profilerTypeName);
            } catch (error) {
                localStorage.removeItem(this.groupToken);
                this.showModal(error.message + " Refreshing page...");
                setTimeout(() => {
                    location.reload();
                }, 2000);
            }
        },

        /**
         * Load questions and answer options
         * @param {string} profilerTypeName - The type of profiler
         */
        async loadQuestions(profilerTypeName) {
            try {
                // Teacher-responder mode: authenticate with JWT bearer token
                // Parent mode: authenticate with the profile token
                const response = this.isTeacherResponder
                    ? await this.fetchWithAuth(`/api/profiler-type/${profilerTypeName}`)
                    : await fetch(`/api/profiler-type/${profilerTypeName}?profileToken=${this.profile.token}`);
                if (!response.ok) throw new Error('Failed to load questions.');
                const data = await response.json();
                this.questions = data.questions;
                this.options = data.answerOptions;
            } catch (error) {
                this.showModal(error.message);
                console.error(error);
            }
        },

        /**
         * Update profile name
         */
        async updateProfileName() {
            try {
                await fetch(`/api/profile/${this.profile.id}/name?profileToken=${this.profile.token}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: this.profile.name }),
                });
            } catch (error) {
                this.showModal(error.message);
                console.error(error);
            }
        },

        /**
         * Debounced update of profile name
         */
        async debouncedUpdateProfileName() {
            clearTimeout(this.debounceTimeout);
            this.debounceTimeout = setTimeout(() => {
                this.updateProfileName();
            }, 1000); 
        },

        /**
         * Submit an answer for a question
         * @param {number} index - Question index
         * @param {number} value - Answer value
         */
        async submitAnswer(index, value) {
            try {
                const previousValue = this.answers[index];
                this.answers[index] = value;
                try {
                    const body = { question: new String(index), score: value };
                    if (this.responderType) {
                        body.responderType = this.responderType;
                    }

                    let fetchFn;
                    let url;
                    if (this.isTeacherResponder) {
                        url = `/api/profile/${this.profile.id}/answer`;
                        fetchFn = (u, o) => this.fetchWithAuth(u, o);
                    } else {
                        url = `/api/profile/${this.profile.id}/answer?profileToken=${this.profile.token}`;
                        fetchFn = fetch;
                    }

                    await fetchFn(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });

                    // Advance to the next question automatically if the next question is unanswered
                    const nextQuestionIndex = this.currentQuestion + 1;
                    if (this.unansweredQuestions.includes(nextQuestionIndex-1) || nextQuestionIndex === this.totalQuestions) {
                        this.$nextTick(() => {
                            sleep(250).then(() => {
                                this.currentQuestion = nextQuestionIndex;
                            });
                        });
                    }
                } catch (error) {
                    if (previousValue === undefined) {
                        delete this.answers[index];
                    } else {
                        this.answers[index] = previousValue;
                    }
                    throw error; // Re-throw the error to handle it elsewhere if needed
                }
            } catch (error) {
                this.showModal(error.message);
                console.error(error);
            }
        },

        /**
         * Count unanswered questions
         * @returns {number} Number of unanswered questions
         */
        countUnansweredQuestions() {
            return this.unansweredQuestions.length;
        },

        /**
         * Get unanswered questions
         * @returns {Array<number>} Indices of unanswered questions
         */
        get unansweredQuestions() {
            const unanswered = [];
            for (let i = 0; i < this.questions.length; i++) {
                const q = this.questions[i];
                const text = (typeof q === 'object' && q !== null) ? q.question : q;
                if (!(text in this.answers)) {
                    unanswered.push(i);
                }
            }
            return unanswered;
        },

        /**
         * Validate profile data
         * @returns {Promise<boolean>} Validation result
         */
        async validateProfile() {
            this.validation.validating = true;
            this.validation.fields.name_blank = !this.profile.name?.trim();
            this.validation.fields.questions_unanswered = this.countUnansweredQuestions() > 0;
            return !Object.values(this.validation.fields).some(value => value);
        },

        /**
         * Finalize and submit the profile
         */
        async finalizeProfile() {
            try {
                const valid = await this.validateProfile();
                if (valid) {
                    if (this.isTeacherResponder) {
                        // Teacher-responder mode: don't change profile status, just confirm
                        this.modal.showX = true;
                        this.showModal(`School assessment complete for ${this.profile.name}! You can close this tab.`);
                    } else {
                        await fetch(`/api/profile/${this.profile.id}/complete?profileToken=${this.profile.token}`, {
                            method: 'PUT',
                        });
                        localStorage.removeItem(this.groupToken);
                        this.showModal('Profile submitted successfully!');
                    }
                }
            } catch (error) {
                this.showModal(error.message);
                console.error(error);
            }
        },

        /**
         * Show a modal with a message
         * @param {string} message - Message to display
         */
        showModal(message) {
            this.modal.message = message;
            this.modal.active = true;
            this.modal.showX = false;
        },

        /**
         * Fetch with teacher bearer auth
         */
        fetchWithAuth(url, options = {}) {
            const token = localStorage.getItem('token');
            if (!options.headers) options.headers = {};
            options.headers['Authorization'] = `Bearer ${token}`;
            if (!options.headers['Content-Type'] && options.body) {
                options.headers['Content-Type'] = 'application/json';
            }
            return fetch(url, options);
        },

        /**
         * Initialize teacher-responder mode
         * Teacher fills out school scores for an existing profile
         */
        async initTeacherResponderMode() {
            // Verify teacher is logged in
            const userResponse = await this.fetchWithAuth('/users/me');
            if (!userResponse.ok) {
                window.location.href = '/c/login/';
                return;
            }

            // Load the profile
            try {
                const response = await this.fetchWithAuth(`/api/profile/${this.teacherProfileId}`);
                if (!response.ok) throw new Error('Failed to load profile.');
                const data = await response.json();
                this.profile.id = data.id;
                this.profile.name = data.name;
                this.groupDisplayAs = data.groupDisplayAs;

                // Load existing answers for this responderType
                for (const answer of data.answers) {
                    if (answer.responderType === this.responderType) {
                        this.answers[answer.question] = answer.score;
                    }
                }

                await this.loadQuestions(data.profilerTypeName);
            } catch (error) {
                this.showModal(error.message);
                console.error(error);
                return;
            }

            // Watch for question changes (skip button)
            this.$watch('currentQuestion', value => {
                this.showSkip = false;
                this.$nextTick(() => {
                    sleep(1000).then(() => {
                        if (this.currentQuestion === value) {
                            const qIndex = this.currentQuestion - 1;
                            if (this.questions[qIndex] in this.answers) {
                                this.showSkip = true;
                            }
                        }
                    });
                });
            });

            // Skip name screen, go to first unanswered question
            // In teacher mode, currentQuestion 0 is skipped (no name entry needed)
            // Name is already set and readonly, validation.name_blank is false
            this.validation.fields.name_blank = false;
            await this.$nextTick(() => {
                if (this.unansweredQuestions.length > 0) {
                    this.currentQuestion = this.unansweredQuestions[0] + 1;
                } else {
                    this.currentQuestion = this.totalQuestions - 1;
                }
            });
        },
    };
}

// Ensure profilerApp is available globally
window.profilerApp = profilerApp;
