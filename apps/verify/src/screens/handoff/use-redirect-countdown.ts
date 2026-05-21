import { useEffect, useState } from "react";
import { redirectToUrl } from "@/utils/navigation";

export function useRedirectCountdown({
	targetUrl,
	seconds,
}: {
	targetUrl: string | null;
	seconds: number;
}): number | null {
	const [countdown, setCountdown] = useState<number | null>(null);

	useEffect(() => {
		if (!targetUrl) {
			setCountdown(null);
			return;
		}

		setCountdown(seconds);
		const intervalId = window.setInterval(() => {
			setCountdown((current) => {
				if (current === null) {
					return seconds;
				}
				return Math.max(0, current - 1);
			});
		}, 1000);
		const timeoutId = window.setTimeout(() => {
			redirectToUrl(targetUrl);
		}, seconds * 1000);

		return () => {
			window.clearInterval(intervalId);
			window.clearTimeout(timeoutId);
		};
	}, [seconds, targetUrl]);

	return countdown;
}
