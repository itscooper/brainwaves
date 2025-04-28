/**
 * Admin interface component for managing users and system settings.
 * Handles user management operations including creation, updates, and deletion.
 * @returns {Object} Alpine.js component definition
 */
function profilerAdmin() {
    return {
        // State properties
        me: {},
        users: [],
        isNewUserModalOpen: false,
        isPasswordModalOpen: false,
        isDeleteModalOpen: false,
        selectedUserId: null,
        newUser: {
            email: '',
            is_superuser: false
        },
        generatedPassword: '',

        /**
         * Initialize the admin interface
         * Validates superuser access and loads user list
         * @returns {Promise<void>}
         */
        async init() {
            const userResponse = await this.fetchWithAuth('/users/me');
            if (!userResponse.ok) {
                window.location.href = '/c/login/';
                return;
            }

            try {
                this.me = await userResponse.json();
                if (!this.me.is_superuser) {
                    window.location.href = '/c/';
                    return;
                }

                const response = await this.fetchWithAuth('/users');
                if (!response.ok) {
                    throw new Error('Failed to load users');
                }

                this.users = await response.json();

                // Set breadcrumbs
                this.$nextTick(() => { 
                    this.$dispatch('setBreadcrumbs', {
                        breadcrumbs: [
                            {name: 'Home', url: '/c/', active: false},
                            {name: 'Admin', url: '/c/admin/', active: false}
                        ]
                    });
                });
            } catch (error) {
                this.notify('Failed to initialize admin interface: ' + error.message, 'is-danger', 5000);
            }
        },

        /**
         * Modal management methods
         */
        closeNewUserModal() {
            this.isNewUserModalOpen = false;
            this.newUser = { email: '', is_superuser: false };
        },

        closePasswordModal() {
            this.isPasswordModalOpen = false;
            this.generatedPassword = '';
        },

        /**
         * Create a new user
         * @returns {Promise<void>}
         */
        async addUser() {
            try {
                const response = await this.fetchWithAuth('/users', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(this.newUser)
                });

                if (!response.ok) {
                    throw new Error('Failed to create user');
                }

                const result = await response.json();
                this.users.push(result);
                
                // Close the new user modal and show the password modal
                this.closeNewUserModal();
                this.generatedPassword = result.password;
                this.isPasswordModalOpen = true;
                
                this.notify('User created successfully', 'is-success', 3000);
            } catch (error) {
                this.notify('Failed to create user: ' + error.message, 'is-danger', 5000);
            }
        },

        /**
         * Copy generated password to clipboard
         * @returns {Promise<void>}
         */
        async copyPasswordToClipboard() {
            try {
                await navigator.clipboard.writeText(this.generatedPassword);
                this.notify('Password copied to clipboard', 'is-success', 3000);
            } catch (error) {
                this.notify('Failed to copy password', 'is-danger', 3000);
            }
        },

        /**
         * Toggle superuser status for a user
         * @param {string} userId - ID of user to update
         * @returns {Promise<void>}
         */
        async togAdmin(userId) {
            const user = this.users.find(u => u.id === userId);
            if (!user) return;

            try {
                const response = await this.fetchWithAuth(`/users/${userId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        is_superuser: !user.is_superuser
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to update user');
                }

                const updatedUser = await response.json();
                this.users = this.users.map(u => u.id === userId ? updatedUser : u);
                this.notify('User admin status updated', 'is-success', 3000);
            } catch (error) {
                this.notify('Failed to update user: ' + error.message, 'is-danger', 5000);
            }
        },

        /**
         * Toggle active status for a user
         * @param {string} userId - ID of user to update
         * @returns {Promise<void>}
         */
        async togActive(userId) {
            const user = this.users.find(u => u.id === userId);
            if (!user) return;

            try {
                const response = await this.fetchWithAuth(`/users/${userId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        is_active: !user.is_active
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to update user');
                }

                const updatedUser = await response.json();
                this.users = this.users.map(u => u.id === userId ? updatedUser : u);
                this.notify('User active status updated', 'is-success', 3000);
            } catch (error) {
                this.notify('Failed to update user: ' + error.message, 'is-danger', 5000);
            }
        },

        /**
         * Reset password for a user
         * @param {string} userId - ID of user to reset password for
         * @returns {Promise<void>}
         */
        async resetPassword(userId) {
            try {
                const response = await this.fetchWithAuth(`/users/${userId}/reset-password`, {
                    method: 'POST'
                });

                if (!response.ok) {
                    throw new Error('Failed to reset password');
                }

                const result = await response.json();
                this.generatedPassword = result.password;
                this.isPasswordModalOpen = true;
                this.notify('Password reset successfully', 'is-success', 3000);
            } catch (error) {
                this.notify('Failed to reset password: ' + error.message, 'is-danger', 5000);
            }
        },

        /**
         * Show delete confirmation modal
         * @param {string} userId - ID of user to potentially delete
         */
        showDeleteModal(userId) {
            this.selectedUserId = userId;
            this.isDeleteModalOpen = true;
        },

        closeDeleteModal() {
            this.isDeleteModalOpen = false;
            this.selectedUserId = null;
        },

        /**
         * Delete a user
         * @returns {Promise<void>}
         */
        async deleteUser() {
            if (!this.selectedUserId) return;

            try {
                const response = await this.fetchWithAuth(`/users/${this.selectedUserId}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    throw new Error('Failed to delete user');
                }

                this.users = this.users.filter(u => u.id !== this.selectedUserId);
                this.closeDeleteModal();
                this.notify('User deleted successfully', 'is-success', 3000);
            } catch (error) {
                this.notify('Failed to delete user: ' + error.message, 'is-danger', 5000);
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
        }
    };
}

// Ensure profilerAdmin is available globally
window.profilerAdmin = profilerAdmin;