import { ref, onMounted } from 'vue';

export function useFeatureGate(api: any, featureKey: string) {
    const allowed = ref(true); // optimistic default
    const loading = ref(true);
    const error = ref<string | null>(null);
    const isAdmin = ref(false);

    async function check() {
        loading.value = true;
        error.value = null;

        try {
            const res = await api.get('/features/my');
            const features: Array<{ key: string; enabled: boolean; source: string }> = res.data?.data ?? res.data ?? [];

            // Admin bypass — all features have source='admin'
            if (features.length > 0 && features[0].source === 'admin') {
                isAdmin.value = true;
                allowed.value = true;
                loading.value = false;
                return;
            }

            const feature = features.find((f: any) => f.key === featureKey);
            if (!feature) {
                // Feature not registered — fail-open in CMS (gateway enforces)
                allowed.value = true;
            } else {
                allowed.value = feature.enabled;
            }
        } catch (err: any) {
            // Fail-open: if we can't check, allow (gateway is the real gate)
            error.value = err?.message || 'Feature check failed';
            allowed.value = true;
        } finally {
            loading.value = false;
        }
    }

    onMounted(check);

    return { allowed, loading, error, isAdmin, check };
}
