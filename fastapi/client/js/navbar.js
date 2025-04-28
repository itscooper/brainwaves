// Navbar (components/notifications.html)
document.addEventListener('alpine:init', () => {
    Alpine.data('navbar', () => ({
        async init() {
            document.addEventListener('setBreadcrumbs', (event) => {
                const newBreadcrumbs = event.detail.breadcrumbs;
                this.breadcrumbs = newBreadcrumbs;
            });

            const userResponse = await this.fetchWithAuth('/users/me');
            if (userResponse.ok) {
                this.me = await userResponse.json();
            }

        },
        logout() {
            localStorage.removeItem('token');
            window.location.href = '/c/login';
        },
        // Array of objects like: [{name:'Page Name',url:'/c/link',active:false},{...}]
        breadcrumbs:[],
        touchMenuOpen:false,
        me:{},
        passwordModalOpen: false,
        newPassword: '',
        confirmPassword: '',

        openPasswordModal() {
            this.passwordModalOpen = true;
            this.newPassword = '';
            this.confirmPassword = '';
        },

        closePasswordModal() {
            this.passwordModalOpen = false;
            this.newPassword = '';
            this.confirmPassword = '';
        },

        async changePassword() {
            if (this.newPassword !== this.confirmPassword) {
                this.showNotification('Passwords do not match', 'is-danger');
                return;
            }

            const response = await fetch('/users/me', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    password: this.newPassword
                })
            });

            if (response.ok) {
                this.showNotification('Password changed successfully', 'is-success');
                this.closePasswordModal();
            } else {
                this.showNotification('Failed to change password', 'is-danger');
            }
        },

        showNotification(message, type) {
            const event = new CustomEvent('add-notification', {
                detail: { message, type, duration: 3000 }
            });
            document.dispatchEvent(event);
        }
    }));
});

// Ensure the navbar is recognized globally
window.initializeNotificationSystem = () => {
    document.dispatchEvent(new Event('alpine:init'));
};