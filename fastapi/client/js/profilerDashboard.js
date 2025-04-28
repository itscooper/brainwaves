function profilerDashboard() {
    return {
        groups: [],
        profilerTypes: [],
        newGroup: { name: '', displayAs: '', profilerTypeName: '' },
        isModalOpen: false,
        copyingUrlFor: '',
        includeArchivedGroups: false,

        shortenText(text, maxLength = 15) {
            if (text.length <= maxLength) return text;
            return text.substring(0, maxLength - 1) + '…';
        },

        async init() {
            const userResponse = await this.fetchWithAuth('/users/me');
            if (!userResponse.ok) {
                window.location.href = '/c/login/';
                return;
            }

            this.fetchGroups();
            this.$watch('includeArchivedGroups', value => this.fetchGroups());
            this.fetchProfilerTypes();
            
            // Set breadcrumbs
            this.$nextTick(() => { 
                this.$dispatch('setBreadcrumbs',{breadcrumbs:[
                    {name:'Home',url:'/c/',active:true}
                ]});
            });
        },

        async fetchGroups() {
            this.groups = [];
            const url = this.includeArchivedGroups ? '/api/groups?includeArchived=true' : '/api/groups';
            const response = await this.fetchWithAuth(url);
            if (response.ok) {
                this.groups = await response.json();
            }
        },

        async fetchProfilerTypes() {
            const response = await this.fetchWithAuth('/api/profiler-type');
            if (response.ok) {
                this.profilerTypes = await response.json();
            }
        },

        openModal() {
            this.isModalOpen = true;
        },

        closeModal() {
            this.isModalOpen = false;
            this.newGroup = { name: '', displayAs: '', profilerTypeName: '' };
        },

        async addGroup() {
            const response = await this.fetchWithAuth('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.newGroup),
            });

            if (response.ok) {
                this.closeModal();
                this.fetchGroups();
            }
        },

        copyLink(token,groupname) {
            this.copyingUrlFor = groupname;
            navigator.clipboard.writeText(`${window.location.origin}/c/form?groupToken=${token}`).then(() => {
                sleep(1000).then(() => {
                    this.notify("Link copied to clipboard!","is-success",3000)
                    this.copyingUrlFor = '';
                });
            });
        },

        async fetchWithAuth(url, options = {}) {
            const token = localStorage.getItem('token');
            if (!token) {
                console.error('No token found in localStorage');
                window.location.href = '/c/login/';
                return new Response(null, { status: 401 });
            }

            const headers = {
                ...options.headers,
                Authorization: `Bearer ${token}`,
            };

            const response = await fetch(url, { ...options, headers });
            if (response.status === 401) {
                console.warn('Unauthorized request, redirecting to login');
                window.location.href = '/c/login/';
            }
            return response;
        },

        notify(message,type,duration) { 
            this.$dispatch('add-notification', { message: message, type: type, duration: duration }); 
        },
    };
}

// Ensure profilerDashboard is available globally
window.profilerDashboard = profilerDashboard;