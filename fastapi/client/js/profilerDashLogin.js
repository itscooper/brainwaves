function profilerDashLogin() {
    return {
        username: '',
        password: '',
        newPassword: '',
        error: null,
        passwordChangeError: null,
        passwordChangeRequired: false,

        async init() {
            this.checkLogin();
        },

        async checkLogin() {
            try {
                const response = await fetch('/users/me', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`, 
                    },
                });
                if (response.ok) {
                    const userData = await response.json();
                    console.log('User is already logged in:', userData);
                    window.location.href = '../'; // Redirect 
                } else if (response.status === 401) {
                    console.log('User is not logged in. They\'re on the right page!');
                } else {
                    console.error('Unexpected error during login check: ', response.status);
                }
            } catch (error) {
                console.error('Error checking login status: ', error);
            }
        },

        async submitLogin() {
            // Reset error
            this.error = null;

            try {
                // Perform login API call
                const response = await fetch('/auth/jwt/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        username: this.username,
                        password: this.password,
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    this.error = 'Login failed. Response: ' + errorData.detail || 'Login failed.';
                    return;
                }

                const passwordChangeHeader = response.headers.get('X-Password-Change-Required');
                const data = await response.json();
                localStorage.setItem('token', data.access_token);

                // If the user needs to change their password
                if (passwordChangeHeader === 'true') {
                    this.passwordChangeRequired = true;
                } else {
                    window.location.href = '../';
                }
            } catch (e) {
                this.error = 'An unexpected error occurred. Please try again.';
            }
        },

        async submitPasswordChange() {
            this.passwordChangeError = null;
            try {
                const token = localStorage.getItem('token');
                if (!token) throw new Error('Missing token');

                const response = await fetch('/users/me', {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ password: this.newPassword }),
                });

                if (!response.ok) {
                    const data = await response.json();
                    this.passwordChangeError = data.detail || 'Password change failed';
                    return;
                }

                window.location.href = '../';
            } catch (err) {
                this.passwordChangeError = 'An unexpected error occurred';
            }
        },
    };
}

// Ensure profilerDashLogin is available globally
window.profilerDashLogin = profilerDashLogin;