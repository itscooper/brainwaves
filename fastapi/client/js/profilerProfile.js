/**
 * Profile viewer/editor component for the profiler interface.
 * Handles displaying and managing individual profile data, including charts and practice recommendations.
 * @returns {Object} Alpine.js component definition
 */
function profilerProfile() {
    return {
        // State properties
        profile: {},
        uniqueDomains: [],
        domainScores: [],
        subdomainScores: [],
        responderDomainScores: {},
        isEditModalOpen: false,
        isDeleteModalOpen: false,
        width: 400,
        height: 400,
        profilerType: null,
        isLoading: true,
        profileNewName: '',
        practiceData: null,
        practiceItems: [],
        practiceLabel: 'OAIP',
        practiceTooltip: '',
        showAllPractices: false,

        /**
         * Get practices to display based on showAllPractices flag
         * @returns {Array} Filtered practice items
         */
        get displayedPractices() {
            return this.showAllPractices ? this.practiceItems : this.practiceItems.slice(0, 5);
        },

        /**
         * Build a pivoted list of answers: one entry per unique question,
         * with separate score keys per responderType (or a single 'default' key).
         * Each entry: {question, domain, subdomain, scores: {home: n, school: n, ...}}
         */
        get pivotedAnswers() {
            if (!this.profile.answers) return [];
            const map = new Map();
            const hasRT = !!this.profilerType?.responderTypes;
            for (const answer of this.profile.answers) {
                const q = answer.question;
                if (!map.has(q)) {
                    map.set(q, {question: q, domain: answer.domain, subdomain: answer.subdomain || '', scores: {}});
                }
                const rt = answer.responderType || 'default';
                map.get(q).scores[rt] = answer.score;
            }
            return Array.from(map.values());
        },

        get hasSchoolResponder() {
            return !!this.profilerType?.responderTypes;
        },

        /**
         * Convert numeric score to text answer
         * @param {number} score - Numeric score value
         * @returns {string} Text representation of the answer
         */
        getAnswerText(score) {
            if (!this.profilerType?.answerOptions) return '';
            const key = Object.keys(this.profilerType.answerOptions).find(
                key => this.profilerType.answerOptions[key] === score
            );
            return key || '';
        },

        /**
         * Initialize the profile page
         */
        async init() {
            const userResponse = await this.fetchWithAuth('/users/me');
            if (!userResponse.ok) {
                window.location.href = '/c/login/';
                return;
            }

            try {
                // Load profile data
                const profileId = new URLSearchParams(window.location.search).get('id');
                const response = await this.fetchWithAuth(`/api/profile/${profileId}`);
                if (!response.ok) {
                    window.location.href = '/c/';
                    return;
                }

                this.profile = await response.json();
                this.profileNewName = this.profile.name;

                // Load profiler type and calculate scores
                await this.getProfilerType();
                this.calculateDomainScores();

                // Set breadcrumbs
                this.$nextTick(() => { 
                    this.$dispatch('setBreadcrumbs', {
                        breadcrumbs: [
                            {name: 'Home', url: '/c/', active: false},
                            {name: this.profile.groupName, url: `/c/group/?name=${this.profile.groupName}`, active: false},
                            {name: this.profile.name, url: `/c/profile/?id=${this.profile.id}`, active: false}
                        ]
                    });
                });

                // Initialize chart
                this.$nextTick(() => {
                    if (this.uniqueDomains.length > 0) {
                        const ctx = document.getElementById('profileRadar');
                        const hasResponderTypes = !!this.profilerType?.responderTypes;
                        const usePercentage = hasResponderTypes || Object.keys(this.profilerType?.answerOptions || {}).length > 3;
                        
                        let datasets;
                        if (hasResponderTypes && Object.keys(this.responderDomainScores).length > 0) {
                            const colors = {
                                school: {border: 'rgba(54, 162, 235, 1)', bg: 'rgba(54, 162, 235, 0.2)'},
                                home: {border: 'rgba(255, 99, 132, 1)', bg: 'rgba(255, 99, 132, 0.2)'}
                            };
                            datasets = Object.entries(this.responderDomainScores).map(([rt, scores]) => ({
                                label: rt.charAt(0).toUpperCase() + rt.slice(1),
                                data: scores.map(s => usePercentage ? s.percentage : s.score),
                                borderColor: colors[rt]?.border || 'rgba(75, 192, 192, 1)',
                                backgroundColor: colors[rt]?.bg || 'rgba(75, 192, 192, 0.2)',
                                borderWidth: 2
                            }));
                        } else {
                            datasets = [{
                                label: usePercentage ? 'Score (%)' : 'Score',
                                data: this.domainScores.map(s => usePercentage ? s.percentage : s.score),
                                borderWidth: 1
                            }];
                        }

                        new Chart(ctx, {
                            type: 'radar',
                            data: {
                                labels: this.uniqueDomains,
                                datasets
                            },
                            options: {
                                responsive: true,
                                scales: {
                                    r: {
                                        min: 0,
                                        max: usePercentage ? 100 : undefined,
                                        ticks: {
                                            stepSize: usePercentage ? 20 : 1,
                                            callback: usePercentage ? (v) => v + '%' : undefined
                                        }
                                    }
                                }
                            }
                        });
                    }
                });

                // Load practices if available
                if (this.profilerType?.practiceSource) {
                    await this.loadPractices();
                }
            } catch (error) {
                console.error('Error initializing profile:', error);
                this.notify('Failed to load profile data', 'is-danger', 5000);
            } finally {
                this.isLoading = false;
            }
        },

        /**
         * Calculate domain scores from profile answers
         */
        calculateDomainScores() {
            if (!this.uniqueDomains || !this.profile.answers) return;
            
            const maxVal = Math.max(...Object.values(this.profilerType?.answerOptions || {}));
            const hasResponderTypes = !!this.profilerType?.responderTypes;
            
            // Build per-responder domain and subdomain maps
            const responderDomainMap = {};
            const responderSubdomainMap = {};
            for (const answer of this.profile.answers) {
                const rt = answer.responderType || 'default';
                if (!responderDomainMap[rt]) responderDomainMap[rt] = {};
                if (!responderDomainMap[rt][answer.domain]) responderDomainMap[rt][answer.domain] = {score: 0, count: 0};
                responderDomainMap[rt][answer.domain].score += answer.score;
                responderDomainMap[rt][answer.domain].count++;
                if (answer.subdomain) {
                    const key = `${answer.domain}|${answer.subdomain}`;
                    if (!responderSubdomainMap[rt]) responderSubdomainMap[rt] = {};
                    if (!responderSubdomainMap[rt][key]) responderSubdomainMap[rt][key] = {domain: answer.domain, subdomain: answer.subdomain, score: 0, count: 0};
                    responderSubdomainMap[rt][key].score += answer.score;
                    responderSubdomainMap[rt][key].count++;
                }
            }
            const responderKeys = Object.keys(responderDomainMap);
            const isMultiResponder = hasResponderTypes && (responderKeys.length > 1 || (responderKeys.length === 1 && !responderKeys.includes('default')));

            // Calculate domain scores — use highest score across responders for multi-responder profilers
            this.domainScores = [];
            for (const domain of this.uniqueDomains) {
                let score, maxScore;
                if (isMultiResponder) {
                    // Find the responder with the highest percentage for this domain
                    let bestPct = -1, bestScore = 0, bestMax = 1;
                    for (const rt of responderKeys) {
                        const d = responderDomainMap[rt]?.[domain];
                        if (d && d.count > 0) {
                            const ms = d.count * maxVal;
                            const pct = d.score / ms;
                            if (pct > bestPct) { bestPct = pct; bestScore = d.score; bestMax = ms; }
                        }
                    }
                    score = bestScore; maxScore = bestMax;
                } else {
                    let total = 0, count = 0;
                    for (const answer of this.profile.answers) {
                        if (answer.domain === domain) { total += answer.score; count++; }
                    }
                    score = total; maxScore = count > 0 ? count * maxVal : 1;
                }
                const percentage = Math.round((score / maxScore) * 100);
                this.domainScores.push({domain, score, maxScore, percentage});
            }

            // Calculate subdomain scores — use highest score across responders
            this.subdomainScores = [];
            const allSdKeys = new Set();
            for (const rt of responderKeys) Object.keys(responderSubdomainMap[rt] || {}).forEach(k => allSdKeys.add(k));
            for (const key of allSdKeys) {
                let score, count, domain, subdomain;
                if (isMultiResponder) {
                    let bestPct = -1, bestScore = 0, bestCount = 1;
                    for (const rt of responderKeys) {
                        const sd = responderSubdomainMap[rt]?.[key];
                        if (sd && sd.count > 0) {
                            const pct = sd.score / (sd.count * maxVal);
                            if (pct > bestPct) { bestPct = pct; bestScore = sd.score; bestCount = sd.count; domain = sd.domain; subdomain = sd.subdomain; }
                        }
                    }
                    score = bestScore; count = bestCount;
                } else {
                    const sd = (responderSubdomainMap[responderKeys[0]] || {})[key] || {};
                    score = sd.score || 0; count = sd.count || 1; domain = sd.domain; subdomain = sd.subdomain;
                }
                const maxScore = count * maxVal;
                const percentage = Math.round((score / maxScore) * 100);
                this.subdomainScores.push({domain, subdomain, score, count, maxScore, percentage});
            }

            // Calculate per-responder domain scores for dual-responder profilers
            this.responderDomainScores = {};
            if (hasResponderTypes) {
                for (const rt of Object.keys(responderDomainMap)) {
                    if (rt === 'default') continue;
                    this.responderDomainScores[rt] = [];
                    for (const domain of this.uniqueDomains) {
                        const d = responderDomainMap[rt]?.[domain];
                        const total = d?.score || 0;
                        const count = d?.count || 0;
                        const maxScore = count > 0 ? count * maxVal : 1;
                        const percentage = Math.round((total / maxScore) * 100);
                        this.responderDomainScores[rt].push({domain, score: total, maxScore, percentage});
                    }
                }
            }
        },

        /**
         * Load profiler type data
         */
        async getProfilerType() {
            try {
                const response = await this.fetchWithAuth(`/api/profiler-type/${this.profile.profilerTypeName}`);
                if (!response.ok) throw new Error('Failed to load questions.');
                const data = await response.json();
                this.profilerType = data;
                this.uniqueDomains = data.domains;
            } catch (error) {
                console.error('Error loading profiler type:', error);
                this.notify('Failed to load profiler type', 'is-danger', 5000);
            }
        },

        /**
         * Load and process practice recommendations
         */
        async loadPractices() {
            try {
                const response = await this.fetchWithAuth(`/api/practices/${this.profilerType.practiceSource}`);
                if (!response.ok) {
                    throw new Error('Failed to load practices.');
                }
                
                this.practiceData = await response.json();

                // Store label from the practice file
                if (this.practiceData && typeof this.practiceData === 'object' && !Array.isArray(this.practiceData)) {
                    this.practiceLabel = this.practiceData.label || 'OAIP';
                    this.practiceTooltip = this.practiceData.labelTooltip || '';
                }

                // Calculate practice scores
                const practiceScores = new Map();
                
                // Initialize scores from questions
                for (const question of this.profilerType.questions_extended) {
                    if (question.practice) {
                        const practiceId = Array.isArray(question.practice) 
                            ? (Array.from(question.practice)[0] || '') 
                            : question.practice;
                            
                        if (practiceId) {
                            if (!practiceScores.has(practiceId)) {
                            practiceScores.set(practiceId, {
score: 0,
count: 0
});
}
                        }
                    }
                }

                // Calculate scores from answers — use highest score per question across responders
                const qResponderScores = {};
                for (const answer of this.profile.answers) {
                    const rt = answer.responderType || 'default';
                    const q = answer.question;
                    if (!qResponderScores[q]) qResponderScores[q] = {};
                    qResponderScores[q][rt] = (qResponderScores[q][rt] || 0) + answer.score;
                }
                for (const [q, rtScores] of Object.entries(qResponderScores)) {
                    const bestScore = Math.max(...Object.values(rtScores));
                    const question = this.profilerType.questions_extended.find(qu => qu.question === q);
                    if (question?.practice) {
                        const practiceId = Array.isArray(question.practice)
                            ? (Array.from(question.practice)[0] || '')
                            : question.practice;
                        if (practiceId) {
                            const practiceScore = practiceScores.get(practiceId);
                            if (practiceScore) {
                                practiceScore.score += bestScore;
                                practiceScore.count += 1;
                            }
                        }
                    }
                }

                // Create practice items array with scores
                this.practiceItems = Array.from(practiceScores.entries())
                    .map(([practiceId, scores]) => {
                        let practice = null;
                        let categories = [];

                        // Support both plain array and wrapped {label, items} format
                        const practiceItems = Array.isArray(this.practiceData) ? this.practiceData : (this.practiceData?.items || []);

                        // Find practice in data
                        for (const category of practiceItems) {
                            for (const practiceGroup of category.children || []) {
                                if (practiceGroup.id === practiceId) {
                                    practice = practiceGroup;
                                    categories.push(category.name);
                                    break;
                                }
                            }
                            if (practice) break;
                        }

                        if (!practice) return null;

                        return {
                            id: practiceId,
                            name: practice.name,
                            score: scores.count > 0 ? Math.round(scores.score) : 0,
                            categories: categories,
                            strategies: practice.children?.map(c => c.text) || [],
                            isExpanded: false
                        };
                    })
                    .filter(item => item !== null && item.score > 0)
                    .sort((a, b) => b.score - a.score);

            } catch (error) {
                console.error('Error loading practices:', error);
                this.notify('Failed to load practices', 'is-danger', 5000);
            }
        },

        // UI interaction methods
        togglePractice(practiceId) {
            const practice = this.practiceItems.find(p => p.id === practiceId);
            if (practice?.strategies.length > 0) {
                practice.isExpanded = !practice.isExpanded;
            }
        },

        navigateToProfile(profileId) {
            window.location.href = `/c/profile/?id=${profileId}`;
        },

        // Modal management methods
        async openEditModal() {
            this.isEditModalOpen = true;
        },

        async closeEditModal() {
            this.isEditModalOpen = false;
        },

        async editProfile() {
            const response = await this.fetchWithAuth(`/api/profile/${this.profile.id}/name`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name: this.profileNewName }),
            });

            if (response.ok) {
                this.notify('Profile updated', 'is-success', 3000);
                this.profile.name = this.profileNewName;
                this.isEditModalOpen = false;
            } else {
                const error = await response.text();
                this.notify(`Failed to save changes: ${error}`, 'is-danger', 10000);
            }
        },

        async openDeleteModal() {
            this.isDeleteModalOpen = true;
        },

        async closeDeleteModal() {
            this.isDeleteModalOpen = false;
        },

        async deleteProfile() {
            const response = await this.fetchWithAuth(`/api/profile/${this.profile.id}`, { 
                method: 'DELETE' 
            });
            
            if (response.ok) {
                window.location.href = `/c/group/?name=${this.profile.groupName}`;
            } else {
                const error = await response.text();
                this.notify(`Failed to delete profile: ${error}`, 'is-danger', 10000);
            }
        },

        /**
         * Open the school assessment form in a new tab
         */
        openSchoolAssessment() {
            window.open(`/c/form/?profileId=${this.profile.id}&responderType=school`, '_blank');
        },

        /**
         * Get RAG CSS class from a percentage value
         * @param {number} percentage
         * @returns {string}
         */
        getRagClass(percentage) {
            if (percentage == null) return '';
            const t = this.profilerType?.ragThresholds || { green: 33, amber: 66 };
            if (percentage > t.amber) return 'rag-red';
            if (percentage > t.green) return 'rag-amber';
            return 'rag-green';
        },

        /**
         * Authenticated fetch helper
         * @param {string} url - URL to fetch
         * @param {Object} options - Fetch options
         * @returns {Promise<Response>} Fetch response
         */
        async fetchWithAuth(url, options = {}) {
            const token = localStorage.getItem('token');
            if (!token) {
                window.location.href = '/c/login/';
                return;
            }
            return fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    Authorization: `Bearer ${token}`,
                },
            });
        },

        /**
         * Update chart container size
         */
        updateChartSize() {
            const chartContainer = document.getElementById('profileRadarContainer');
            if (chartContainer) {
                const parent = chartContainer.parentElement;
                this.width = parent.offsetWidth;
                this.height = Math.max(400, parent.offsetHeight);
            }
        },

        /**
         * Show a notification
         * @param {string} message - Message to display
         * @param {string} type - Notification type (is-success, is-danger, etc.)
         * @param {number} duration - Display duration in milliseconds
         */
        notify(message, type, duration) { 
            this.$dispatch('add-notification', { 
                message: message, 
                type: type, 
                duration: duration 
            }); 
        },
    };
}

// Ensure profilerProfile is available globally
window.profilerProfile = profilerProfile;