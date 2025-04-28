// Notifications (components/notifications.html)
document.addEventListener('alpine:init', () => {
    Alpine.data('notificationSystem', () => ({
        notifications: [],
        init() {
            document.addEventListener('add-notification', (event) => {
                const { message, type, duration } = event.detail;
                this.addNotification(message, type, duration);
            });
        },
        addNotification(message, type = 'is-primary', duration = 3000) {
            this.notifications.push({ message, type });
            const index = this.notifications.length - 1;
            setTimeout(() => this.removeNotification(index), duration);
        },
        removeNotification(index) {
            this.notifications.splice(index, 1);
        },
    }));
});


/*document.addEventListener('add-notification', (event) => {
    const { message, type, duration } = event.detail;

    const notificationContainer = document.querySelector('.notification-container');
    if (notificationContainer && notificationContainer.__x) {
        notificationContainer.__x.$data.addNotification(message, type, duration);
    }
});*/


// Ensure the notification system is recognized globally
window.initializeNotificationSystem = () => {
    document.dispatchEvent(new Event('alpine:init'));
};