interface StepFunctionEvent {
	[key: string]: any;
}

export const handler = async (event: StepFunctionEvent): Promise<void> => {
	console.log('Look here vvvvv');
	console.log(JSON.stringify({ event }));
};
