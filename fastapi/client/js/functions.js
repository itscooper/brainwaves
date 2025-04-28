/**
 * Creates a promise that resolves after a specified delay
 * @param {number} ms - The delay in milliseconds
 * @returns {Promise<void>} A promise that resolves after the specified delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Expose sleep function globally
window.sleep = sleep;

/**
 * Checks if the application is properly configured with authentication
 * Redirects to login page if no authentication token is found
 * @returns {Promise<void>}
 */
async function checkAppConfiguration() {
    const token = localStorage.getItem('token');
    
    if (!token) {
        console.error('No token found in localStorage');
        window.location.href = '/c/login/';
        return;
    }
}

// Expose checkAppConfiguration function globally
window.checkAppConfiguration = checkAppConfiguration;


