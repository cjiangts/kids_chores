"""Helpers for running Type IV Python generator snippets."""

import ast
import math
import random
from fractions import Fraction

TYPE4_PREVIEW_MAX_SAMPLES = 10
TYPE4_RUNTIME_MAX_SAMPLES = 5000

TYPE4_ALLOWED_BUILTINS = {
    'abs': abs,
    'all': all,
    'any': any,
    'bool': bool,
    'dict': dict,
    'enumerate': enumerate,
    'float': float,
    'int': int,
    'len': len,
    'list': list,
    'max': max,
    'min': min,
    'range': range,
    'round': round,
    'set': set,
    'sorted': sorted,
    'str': str,
    'sum': sum,
    'tuple': tuple,
    'zip': zip,
}

TYPE4_DISALLOWED_NODES = (
    ast.Import,
    ast.ImportFrom,
    ast.ClassDef,
    ast.AsyncFunctionDef,
    ast.Await,
    ast.Yield,
    ast.YieldFrom,
    ast.Raise,
    ast.With,
    ast.AsyncWith,
    ast.Delete,
    ast.Global,
    ast.Nonlocal,
)


def _validate_type4_tree(tree):
    """Reject a few Python constructs we do not want in creator snippets."""
    for node in ast.walk(tree):
        if isinstance(node, TYPE4_DISALLOWED_NODES):
            raise ValueError(f'Unsupported Python construct: {type(node).__name__}')
        if isinstance(node, ast.Attribute) and str(node.attr or '').startswith('__'):
            raise ValueError('Dunder attribute access is not allowed')
        if isinstance(node, ast.Name) and str(node.id or '').startswith('__'):
            raise ValueError('Dunder names are not allowed')


def _normalize_type4_sample(raw_result, index):
    """Normalize one generator output into prompt/answer/distractors."""
    if not isinstance(raw_result, dict):
        raise ValueError(f'generate() must return a dict for sample {index}')

    prompt = str(raw_result.get('prompt') or '').strip()
    answer = str(raw_result.get('answer') or '').strip()
    if not prompt:
        raise ValueError(f'Sample {index} is missing prompt')
    if not answer:
        raise ValueError(f'Sample {index} is missing answer')

    raw_distractors = raw_result.get('distractors')
    if raw_distractors is None:
        raw_distractors = []
    if not isinstance(raw_distractors, (list, tuple)):
        raise ValueError(f'Sample {index} distractors must be a list')

    distractors = []
    seen = set()
    for item in raw_distractors:
        text = str(item or '').strip()
        if not text or text == answer or text in seen:
            continue
        seen.add(text)
        distractors.append(text)

    validate = raw_result.get('validate')
    if validate is not None and not callable(validate):
        raise ValueError(f'Sample {index} validate must be a callable')

    result = {
        'prompt': prompt,
        'answer': answer,
        'distractors': distractors,
    }
    if validate is not None:
        result['validate'] = validate
    return result


def _load_type4_generate_function(generator_code):
    """Compile one generator snippet and return its generate(rng) callable."""
    code = str(generator_code or '').replace('\r\n', '\n').replace('\r', '\n').strip()
    if not code:
        raise ValueError('generatorCode is required')

    try:
        tree = ast.parse(code, mode='exec')
    except SyntaxError as exc:
        raise ValueError(f'Python syntax error on line {exc.lineno}: {exc.msg}') from exc
    _validate_type4_tree(tree)

    env = {
        '__builtins__': TYPE4_ALLOWED_BUILTINS,
        'Fraction': Fraction,
        'math': math,
    }
    try:
        exec(compile(tree, '<type4_generator>', 'exec'), env, env)
    except Exception as exc:
        raise ValueError(f'Failed to load generator: {exc}') from exc

    generate = env.get('generate')
    if not callable(generate):
        raise ValueError('Code must define a callable generate(rng)')
    return generate


def run_type4_generator(generator_code, sample_count=1, seed_base=1000, *, max_samples=TYPE4_RUNTIME_MAX_SAMPLES):
    """Run one generator snippet and return normalized prompt/answer rows."""
    try:
        count = int(sample_count)
    except (TypeError, ValueError) as exc:
        raise ValueError('sample_count must be an integer') from exc
    if count <= 0 or count > int(max_samples):
        raise ValueError(f'sample_count must be between 1 and {int(max_samples)}')

    generate = _load_type4_generate_function(generator_code)

    try:
        resolved_seed_base = int(seed_base)
    except (TypeError, ValueError) as exc:
        raise ValueError('seed_base must be an integer') from exc

    samples = []
    for index in range(count):
        rng = random.Random(resolved_seed_base + index)
        try:
            raw_result = generate(rng)
        except Exception as exc:
            raise ValueError(f'generate() failed for sample {index + 1}: {exc}') from exc
        samples.append(_normalize_type4_sample(raw_result, index + 1))
    return samples


def preview_type4_generator(generator_code, sample_count=3, seed_base=1000):
    """Run one generator snippet in-process for preview."""
    samples = run_type4_generator(
        generator_code,
        sample_count=sample_count,
        seed_base=seed_base,
        max_samples=TYPE4_PREVIEW_MAX_SAMPLES,
    )
    for sample in samples:
        sample.pop('validate', None)
    return samples
