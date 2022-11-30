export function dynamicInstantiate() {}
export function getFormat() {}
export function getSource() {}
export function transformSource() {}


export function resolve(specifier, context, next) {
	if (specifier === 'whatever') return {
		url: specifier,
	};

	return next(specifier);
}

export function load(url, context, next) {
	if (url === 'whatever') return {
		format: 'module',
		source: '',
	};

	return next(url);
}
