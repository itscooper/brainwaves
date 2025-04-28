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
        isEditModalOpen: false,
        isDeleteModalOpen: false,
        width: 400,
        height: 400,
        profilerType: null,
        isLoading: true,
        profileNewName: '',
        practiceData: null,
        practiceItems: [],
        showAllPractices: false,

        /**
         * Get practices to display based on showAllPractices flag
         * @returns {Array} Filtered practice items
         */
        get displayedPractices() {
            return this.showAllPractices ? this.practiceItems : this.practiceItems.slice(0, 5);
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
                        new Chart(ctx, {
                            type: 'radar',
                            data: {
                                labels: this.uniqueDomains,
                                datasets: [{
                                    label: 'Score',
                                    data: this.domainScores.map(scoreObj => scoreObj.score),
                                    borderWidth: 1
                                }]
                            },
                            options: {
                                responsive: true,
                                scales: {
                                    r: {
                                        min: 0,
                                        ticks: {
                                            stepSize: 1
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
            
            this.domainScores = [];
            for (const domain of this.uniqueDomains) {
                let total = 0;
                for (const answer of this.profile.answers) {
                    if (answer.domain === domain) {
                        total += answer.score;
                    }
                }
                this.domainScores.push({"domain": domain, "score": total});
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
                
                // Calculate practice scores
                const practiceScores = new Map();
                
                // Initialize scores from questions
                for (const question of this.profilerType.questions_extended) {
                    if (question.practice) {
                        const practiceId = Array.isArray(question.practice) 
                            ? (Array.from(question.practice)[0] || '') 
                            : question.practice;
                            
                        if (practiceId) {
console.log('Found practice ID:', practiceId, 'for question:', question.question);
                            if (!practiceScores.has(practiceId)) {
                            practiceScores.set(practiceId, {
score: 0,
count: 0
});
}
                        }
                    }
                }

                // Calculate scores from answers
                for (const answer of this.profile.answers) {
                    const question = this.profilerType.questions_extended.find(q => q.question === answer.question);
                    if (question?.practice) {
                        const practiceId = Array.isArray(question.practice) 
                            ? (Array.from(question.practice)[0] || '') 
                            : question.practice;

                        if (practiceId) {
                            const practiceScore = practiceScores.get(practiceId);
                            if (practiceScore) {
                                practiceScore.score += answer.score;
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
                        
                        // Find practice in data
                        for (const category of this.practiceData) {
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