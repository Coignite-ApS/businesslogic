import { ref, watch, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

/**
 * Navigation guard that prompts when there are unsaved changes.
 * Handles both in-app navigation (Vue Router) and browser close/refresh.
 */
export function useUnsavedGuard(isDirty: ComputedRef<boolean>) {
	const showDialog = ref(false);
	let pendingNext: (() => void) | null = null;

	// Vue Router guard
	onBeforeRouteLeave((_to, _from, next) => {
		if (!isDirty.value) return next();
		pendingNext = next;
		showDialog.value = true;
		// Return false to prevent navigation until confirmed
		return false;
	});

	// Browser close/refresh guard
	const onBeforeUnload = (e: BeforeUnloadEvent) => {
		if (!isDirty.value) return;
		e.preventDefault();
	};

	window.addEventListener('beforeunload', onBeforeUnload);
	onBeforeUnmount(() => {
		window.removeEventListener('beforeunload', onBeforeUnload);
	});

	function confirmLeave() {
		showDialog.value = false;
		if (pendingNext) {
			pendingNext();
			pendingNext = null;
		}
	}

	function cancelLeave() {
		showDialog.value = false;
		pendingNext = null;
	}

	return { showDialog, confirmLeave, cancelLeave };
}
