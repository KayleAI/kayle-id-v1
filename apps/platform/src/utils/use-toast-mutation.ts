import {
	type MutationFunction,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorMessage } from "./get-error-message";

interface ToastMessages {
	loading: string;
	success: string;
	error: string;
}

interface ToastMutationOptions<TData, TVariables> {
	mutationFn: MutationFunction<TData, TVariables>;
	messages: ToastMessages;
	invalidate?: ReadonlyArray<readonly unknown[]>;
	onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
	onError?: (error: Error, variables: TVariables) => void;
}

/**
 * `useMutation` + `toast.promise` + query invalidation + `getErrorMessage`
 * collapsed into one call. `trigger(vars)` runs the mutation with toast feedback.
 */
export function useToastMutation<TData, TVariables = void>({
	mutationFn,
	messages,
	invalidate,
	onSuccess,
	onError,
}: ToastMutationOptions<TData, TVariables>) {
	const queryClient = useQueryClient();
	const mutation = useMutation<TData, Error, TVariables>({
		mutationFn,
		onSuccess: async (data, variables) => {
			if (invalidate) {
				await Promise.all(
					invalidate.map((queryKey) =>
						queryClient.invalidateQueries({ queryKey }),
					),
				);
			}
			await onSuccess?.(data, variables);
		},
		onError,
	});

	const trigger = (variables: TVariables): Promise<TData> => {
		const promise = mutation.mutateAsync(variables);
		toast.promise(promise, {
			loading: messages.loading,
			success: messages.success,
			error: (err) => getErrorMessage(err, messages.error),
		});
		return promise;
	};

	return { ...mutation, trigger };
}
