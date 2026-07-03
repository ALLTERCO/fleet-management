import {type ComputedRef, computed} from 'vue';
import {useCustomizationField} from './customization';

export function useNavLabels(): ComputedRef<Record<string, string>> {
    const labels = useCustomizationField('navLabels');
    return computed(() => labels.value ?? {});
}

export function useNavOrder(): ComputedRef<string[]> {
    const order = useCustomizationField('navOrder');
    return computed(() => order.value ?? []);
}

export const navigation = {
    useLabels: useNavLabels,
    useOrder: useNavOrder
};
