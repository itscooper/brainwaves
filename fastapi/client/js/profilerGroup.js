/**
 * Group management component for the profiler interface.
 * Handles displaying and managing group data, including aggregated scores and profiles.
 * @returns {Object} Alpine.js component definition
 */
function profilerGroup() {
    return {
        // State properties
        group: {},
        profiles: [],
        uniqueDomains: [],
        sortColumn: null,
        sortDirection: 'asc',
        showEditIcon: false,
        isEmojiModalVisible: false,
        isEditModalOpen: false,
        isDeleteModalOpen: false,
        isRefreshModalOpen: false,
        groupNewName: '',
        groupNewDisplayAs: '',
        copyingUrl: false,
        width: 400,
        height: 400,
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
         * Get sorted profiles based on current sort settings
         * @returns {Array} Sorted profiles
         */
        get sortedProfiles() {
            if (!this.sortColumn) return this.profiles;
            const sorted = [...this.profiles].sort((a, b) => {
                const aValue = this.sortColumn === 'name' ? a[this.sortColumn] : a.domain_scores?.[this.sortColumn] || 0;
                const bValue = this.sortColumn === 'name' ? b[this.sortColumn] : b.domain_scores?.[this.sortColumn] || 0;
                return aValue > bValue ? 1 : -1;
            });
            return this.sortDirection === 'asc' ? sorted : sorted.reverse();
        },

        /**
         * Initialize the group page
         * @returns {Promise<void>}
         */
        async init() {
            const userResponse = await this.fetchWithAuth('/users/me');
            if (!userResponse.ok) {
                window.location.href = '/c/login/';
                return;
            }

            try {
                const groupName = new URLSearchParams(window.location.search).get('name');
                const response = await this.fetchWithAuth(`/api/groups/${groupName}`);
                if (!response.ok) {
                    throw new Error('Failed to load group data');
                }

                const data = await response.json();
                this.group = data;
                this.profiles = data.profiles || [];
                this.uniqueDomains = [...new Set(this.profiles.flatMap(profile => Object.keys(profile.domain_scores || {})))];
                this.practiceItems = data.practice_recommendations || [];
                
                // Initialize the radar chart
                this.$nextTick(() => {
                    this.initChart(data.aggregated_domain_scores);
                });

                // Set breadcrumbs
                this.$nextTick(() => { 
                    this.$dispatch('setBreadcrumbs', {
                        breadcrumbs: [
                            {name: 'Home', url: '/c/', active: false},
                            {name: this.group.name, url: `/c/group/?name=${this.group.name}`, active: false}
                        ]
                    });
                });
            } catch (error) {
                console.error('Error loading group:', error);
                this.notify('Failed to load group data', 'is-danger', 5000);
                window.location.href = '/c/';
            }
        },

        /**
         * Sort table by column
         * @param {string} column Column to sort by
         */
        sortTable(column) {
            if (this.sortColumn === column) {
                this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortColumn = column;
                this.sortDirection = 'asc';
            }
        },

        /**
         * Navigate to profile page
         * @param {string} profileId Profile ID to navigate to
         */
        navigateToProfile(profileId) {
            window.location.href = `/c/profile/?id=${profileId}`;
        },

        /**
         * Open emoji picker modal
         */
        openEmojiModal() {
            console.log('Opening emoji picker modal');
            this.isEmojiModalVisible = true;

            // Initialize emoji picker if not already done
            const pickerContainer = document.getElementById('emoji-picker');
            if (pickerContainer.childElementCount === 0) {
                const picker = new EmojiMart.Picker({
                    onEmojiSelect: (emoji) => this.updateEmoji(emoji.native),
                });
                pickerContainer.appendChild(picker);
            }
        },

        /**
         * Close emoji picker modal
         */
        closeEmojiModal() {
            this.isEmojiModalVisible = false;
        },

        /**
         * Update group emoji
         * @param {string} newEmoji New emoji to set
         * @returns {Promise<void>}
         */
        async updateEmoji(newEmoji) {
            this.closeEmojiModal();
            try {
                const response = await this.fetchWithAuth(`/api/groups/${this.group.name}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ emoji: newEmoji }),
                });
                
                if (!response.ok) {
                    throw new Error(await response.text());
                }

                console.log('Emoji updated successfully');
                this.group.emoji = newEmoji;
                this.notify('New emoji set', 'is-success', 3000);
            } catch (error) {
                this.notify(`Failed to update emoji: ${error.message}`, 'is-danger', 10000);
            }
        },

        /**
         * Toggle group archive status
         * @returns {Promise<void>}
         */
        async toggleArchive() {
            try {
                const response = await this.fetchWithAuth(`/api/groups/${this.group.name}/archive`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ archived: !this.group.archived }),
                });

                if (!response.ok) {
                    throw new Error(await response.text());
                }

                this.group.archived = !this.group.archived;
                this.notify(
                    this.group.archived ? 'Group archived' : 'Group unarchived',
                    'is-success',
                    3000
                );
            } catch (error) {
                this.notify(`Failed to update archive status: ${error.message}`, 'is-danger', 10000);
            }
        },

        /**
         * Copy group form link to clipboard
         */
        copyLink() {
            this.copyingUrl = true;
            navigator.clipboard.writeText(`${window.location.origin}/c/form?groupToken=${this.group.token}`).then(() => {
                sleep(1000).then(() => {
                    this.notify("Link copied to clipboard!", "is-success", 3000);
                    this.copyingUrl = false;
                });
            });
        },

        /**
         * Modal management methods
         */
        async openEditModal() {
            this.groupNewName = this.group.name;
            this.groupNewDisplayAs = this.group.displayAs;
            this.isEditModalOpen = true;
        },

        async closeEditModal() {
            this.isEditModalOpen = false;
            this.groupNewName = '';
            this.groupNewDisplayAs = '';
        },

        /**
         * Update group details
         * @returns {Promise<void>}
         */
        async editGroup() {
            try {
                const response = await this.fetchWithAuth(`/api/groups/${this.group.name}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        name: this.groupNewName, 
                        displayAs: this.groupNewDisplayAs 
                    }),
                });

                if (!response.ok) {
                    throw new Error(await response.text());
                }

                this.notify('Group updated', 'is-success', 3000);
                this.group.name = this.groupNewName;
                this.group.displayAs = this.groupNewDisplayAs;
                this.isEditModalOpen = false;
            } catch (error) {
                this.notify(`Failed to save changes: ${error.message}`, 'is-danger', 10000);
            }
        },

        async openDeleteModal() {
            this.isDeleteModalOpen = true;
        },

        async closeDeleteModal() {
            this.isDeleteModalOpen = false;
        },

        /**
         * Delete the current group
         * @returns {Promise<void>}
         */
        async deleteGroup() {
            try {
                const response = await this.fetchWithAuth(`/api/groups/${this.group.name}`, { 
                    method: 'DELETE' 
                });

                if (!response.ok) {
                    throw new Error(await response.text());
                }

                window.location.href = '/c/';
            } catch (error) {
                this.notify(`Failed to delete group: ${error.message}`, 'is-danger', 10000);
            }
        },

        async openRefreshModal() {
            this.isRefreshModalOpen = true;
        },

        async closeRefreshModal() {
            this.isRefreshModalOpen = false;
        },

        /**
         * Regenerate group access token
         * @returns {Promise<void>}
         */
        async refreshUrl() {
            try {
                const response = await this.fetchWithAuth(`/api/groups/${this.group.name}/regenerate-token`, { 
                    method: 'POST' 
                });

                if (!response.ok) {
                    throw new Error(await response.text());
                }

                const updatedGroup = await response.json();
                this.group.token = updatedGroup.token;
                this.notify(
                    `New link for this form: ${window.location.origin}/c/form?groupToken=${updatedGroup.token}`,
                    'is-success',
                    10000
                );
            } catch (error) {
                this.notify(`Failed to refresh URL: ${error.message}`, 'is-danger', 10000);
            }
            this.isRefreshModalOpen = false;
        },

        /**
         * Initialize the radar chart with domain scores
         * @param {Object} domainScores Domain scores to display
         */
        initChart(domainScores) {
            if (!this.uniqueDomains || this.uniqueDomains.length === 0) return;

            const ctx = document.getElementById('groupRadar');
            new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: this.uniqueDomains,
                    datasets: [{
                        label: 'Average Score',
                        data: this.uniqueDomains.map(domain => domainScores[domain] || 0),
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        borderColor: 'rgb(54, 162, 235)',
                        pointBackgroundColor: 'rgb(54, 162, 235)',
                        pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: 'rgb(54, 162, 235)',
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
        },

        /**
         * Update chart container size
         */
        updateChartSize() {
            const chartContainer = document.getElementById('groupRadarContainer');
            if (chartContainer) {
                const parent = chartContainer.parentElement;
                this.width = parent.offsetWidth;
                this.height = Math.max(400, parent.offsetHeight);
            }
        },

        /**
         * Toggle practice expansion state
         * @param {string} practiceId Practice ID to toggle
         */
        togglePractice(practiceId) {
            const practice = this.practiceItems.find(p => p.id === practiceId);
            if (practice && practice.strategies) {
                practice.isExpanded = !practice.isExpanded;
            }
        },

        /**
         * Authenticated fetch helper
         * @param {string} url URL to fetch
         * @param {Object} options Fetch options
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
         * Show a notification
         * @param {string} message Message to display
         * @param {string} type Notification type (is-success, is-danger, etc.)
         * @param {number} duration Display duration in milliseconds
         */
        notify(message, type, duration) { 
            this.$dispatch('add-notification', { 
                message: message, 
                type: type, 
                duration: duration 
            }); 
        }
    };
}

// Ensure profilerGroup is available globally
window.profilerGroup = profilerGroup;