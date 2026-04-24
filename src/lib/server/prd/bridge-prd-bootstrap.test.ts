import { describe, it, expect } from 'vitest';
import { isStubOrEmptyPrd } from '$lib/prd/is-stub-or-empty';

describe('isStubOrEmptyPrd', () => {
	it('detects default stub', () => {
		expect(
			isStubOrEmptyPrd(
				`# Product Requirements (Root)

## Vision

## Goals

## Decisions
`
			)
		).toBe(true);
	});

	it('rejects a filled PRD', () => {
		expect(
			isStubOrEmptyPrd(
				`# My App

## Vision
We serve users with feature-rich APIs.

## Goals
- Ship v1
`
			)
		).toBe(false);
	});
});
