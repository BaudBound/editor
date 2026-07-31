export function FieldError({ id, message }: { id: string; message?: string }) {
	if (!message) {
		return null;
	}

	return (
		<p id={id} role="alert" className="mt-1 text-xs leading-4 text-baud-danger">
			{message}
		</p>
	);
}
