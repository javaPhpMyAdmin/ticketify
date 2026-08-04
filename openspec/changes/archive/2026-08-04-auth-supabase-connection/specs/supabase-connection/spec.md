# Supabase Connection Specification

## Purpose

Wiring the Supabase JS client to the real project: environment-driven configuration, client creation, and the `isSupabaseConfigured()` guard that detects configuration errors.

## Requirements

### Requirement: Environment Configuration

The system MUST read the Supabase URL and anon key from the `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` environment variables and MUST fall back to the `expoConfig.extra` values when the variables are absent.

#### Scenario: Environment variables present

- GIVEN valid `EXPO_PUBLIC_*` variables at build time
- WHEN the client module is loaded
- THEN the real project URL and anon key are used

#### Scenario: Environment variables absent

- GIVEN no `EXPO_PUBLIC_*` variables and only placeholder values in `expoConfig.extra`
- WHEN the client module is loaded
- THEN the client is created without throwing
- AND `isSupabaseConfigured()` returns false

### Requirement: Client Creation

The system MUST create a single Supabase client whose auth persists sessions through a SecureStore-backed adapter, auto-refreshes tokens, and does not detect sessions from the URL. Importing the module MUST NOT throw when configuration is missing.

#### Scenario: Module loaded without configuration

- GIVEN the module is imported without configuration
- THEN a client object exists
- AND no exception is raised

### Requirement: Configuration Guard

`isSupabaseConfigured()` MUST return true only when a real URL and anon key are present and MUST return false when either is missing or is a placeholder value.

#### Scenario: Real configuration

- GIVEN a real URL and anon key
- WHEN the guard is evaluated
- THEN it returns true

#### Scenario: Placeholder configuration

- GIVEN placeholder or empty values
- WHEN the guard is evaluated
- THEN it returns false

### Requirement: Live Requests

When configured, the system MUST direct all requests to the configured project host. When not configured, calls MUST fail in a way the caller can detect and MUST NOT crash the app.

#### Scenario: Configured client request

- GIVEN a configured client
- WHEN a request is issued
- THEN the request targets the configured host

#### Scenario: Unconfigured client request

- GIVEN an unconfigured client
- WHEN a request is issued
- THEN the caller receives a detectable error result
- AND the app does not crash
