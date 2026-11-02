# Defect fixture catalogue

Generated from `eval/fixtures.ts`. That TypeScript file is the source of truth for executable trigger code. Changes to a fixture require recapture and a benchmark version review.

All cases are synthetic and intentionally defective. Known causes and acceptable explanations are reviewer-only oracle data and are excluded from model requests.

## BC-001 · Profile action crashes

Category: undefined value

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: An optional profile is undefined, but the handler reads profile.name without a guard.

Expected behavior: Display the profile name or a fallback.

Expected captured evidence: `{"kind":"error","messageIncludes":"undefined"}`

Acceptable explanation: An undefined object is dereferenced; absent profile data is one plausible source.

Relevant verification steps

- Inspect the object immediately before the failing name read.
- Test the action with a missing profile.

## BC-002 · Panel update crashes

Category: DOM assumption

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: The selector targets an element that does not exist in the document.

Expected behavior: Update an existing panel.

Expected captured evidence: `{"kind":"error","messageIncludes":"null"}`

Acceptable explanation: A DOM lookup may return null; verify element existence and render timing.

Relevant verification steps

- Inspect the selector result at the reported script location.
- Test the view before the panel is mounted.

## BC-003 · Configuration fails to load

Category: data parsing

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: A trailing comma makes the configuration string invalid JSON.

Expected behavior: Load the valid configuration.

Expected captured evidence: `{"kind":"error","messageIncludes":"JSON"}`

Acceptable explanation: JSON parsing failed; inspect the exact input rather than assuming a network failure.

Relevant verification steps

- Inspect the string passed to JSON.parse.
- Add a malformed-configuration test.

## BC-004 · Checkout never completes

Category: promise rejection

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: A rejected inventory promise has no catch handler.

Expected behavior: Display a recoverable checkout error.

Expected captured evidence: `{"kind":"unhandled-rejection","messageIncludes":"Inventory unavailable"}`

Acceptable explanation: An inventory-related rejection escaped the checkout error handling.

Relevant verification steps

- Trace the rejected promise to the checkout caller.
- Test the unavailable inventory path.

## BC-005 · Search displays an older result

Category: async race

Reproduction steps

1. Open the fixture
2. Click Run to issue old and new searches
3. Wait for both responses

Known cause: The slower old response overwrites the newer response because no request identity is checked.

Expected behavior: Display new result.

Expected captured evidence: `{"state":"old result"}`

Acceptable explanation: Out-of-order async completion is plausible; without network evidence it remains a hypothesis.

Relevant verification steps

- Delay the first request and speed up the second.
- Record request IDs and completion order.

## BC-006 · Name formatting crashes

Category: missing await

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: The formatter receives a Promise instead of the awaited string.

Expected behavior: Display the uppercase name.

Expected captured evidence: `{"kind":"error","messageIncludes":"toUpperCase"}`

Acceptable explanation: The value is not the expected string; a missing await is a plausible explanation.

Relevant verification steps

- Inspect the value and typeof before formatting.
- Check the async API return contract.

## BC-007 · Counter displays the previous value

Category: stale closure

Reproduction steps

1. Open the fixture
2. Click Run once
3. Wait for the render callback

Known cause: A callback closes over a snapshot before the state increment.

Expected behavior: Display 1.

Expected captured evidence: `{"state":"0"}`

Acceptable explanation: The rendered count may use stale captured state; no exception alone proves the mechanism.

Relevant verification steps

- Inspect which value the scheduled callback captures.
- Test two rapid increments.

## BC-008 · List count does not refresh

Category: state mutation

Reproduction steps

1. Open the fixture
2. Click Run to add an item

Known cause: In-place mutation preserves object identity, causing the render guard to skip the update.

Expected behavior: Display 1 item.

Expected captured evidence: `{"state":"0 items"}`

Acceptable explanation: A skipped state/render update is plausible; inspect state identity and subscriptions.

Relevant verification steps

- Compare old and new state references.
- Replace mutation with a new array in a focused test.

## BC-009 · One click adds two items

Category: duplicate listener

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: The same logical action is registered through two separate listener functions.

Expected behavior: Display 1.

Expected captured evidence: `{"state":"2"}`

Acceptable explanation: The action may execute twice; distinguish duplicate handlers from duplicate requests.

Relevant verification steps

- Count handler invocations for one click.
- Inspect mount/unmount listener registration.

## BC-010 · Clicking the button icon crashes

Category: event target

Reproduction steps

1. Open the fixture
2. Click the icon inside Run

Known cause: The handler reads data from event.target, which is the nested icon, rather than currentTarget.

Expected behavior: Display ITEM.

Expected captured evidence: `{"kind":"error","messageIncludes":"toUpperCase"}`

Acceptable explanation: Nested click targets may lack the expected property; inspect target versus currentTarget.

Relevant verification steps

- Click the text and child icon separately.
- Inspect event.target and currentTarget at the handler.

## BC-011 · Opening the card crashes

Category: receiver binding

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: A detached class method loses its instance receiver when called as a plain function.

Expected behavior: Display the card label.

Expected captured evidence: `{"kind":"error","messageIncludes":"undefined"}`

Acceptable explanation: A missing method receiver can cause an undefined-property read; verify call binding.

Relevant verification steps

- Inspect this inside the failing method.
- Test a bound callback.

## BC-012 · Action works only once

Category: event lifecycle

Reproduction steps

1. Open the fixture
2. Click Run twice

Known cause: The click listener was configured with once:true for an action intended to repeat.

Expected behavior: Display 2 after two clicks.

Expected captured evidence: `{"state":"1"}`

Acceptable explanation: Listener removal or one-shot registration is plausible; inspect the event lifecycle.

Relevant verification steps

- Check listener registration options.
- Add a repeated-action regression test.

## BC-013 · Data panel fails after a response

Category: response parsing

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: The caller tries to parse an HTML error page as JSON.

Expected behavior: Validate the response and show a recoverable error.

Expected captured evidence: `{"kind":"unhandled-rejection","messageIncludes":"JSON"}`

Acceptable explanation: The response format may differ from JSON; check content type and body.

Relevant verification steps

- Inspect response content type before parsing.
- Test an HTML server-error response.

## BC-014 · Products fail to render

Category: HTTP status

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: The caller ignores a mocked404 status and assumes the error body contains an items array.

Expected behavior: Handle404 before rendering products.

Expected captured evidence: `{"kind":"unhandled-rejection","messageIncludes":"map"}`

Acceptable explanation: An error response may have the wrong data shape; the recorded404 is relevant evidence.

Relevant verification steps

- Check response.ok and status handling.
- Test a404 body without items.

## BC-015 · Load action stays pending

Category: network failure

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: A synthetic fetch rejection is not caught by the action.

Expected behavior: Show an offline/retry state.

Expected captured evidence: `{"kind":"unhandled-rejection","messageIncludes":"Failed to fetch"}`

Acceptable explanation: The observed fetch failure needs handling; it does not prove a particular server or CORS cause.

Relevant verification steps

- Simulate an offline failure.
- Inspect the catch/finally path and network details separately.

## BC-016 · Results rendering crashes

Category: data contract

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: The API result is an object, but the renderer expects an array.

Expected behavior: Validate the shape before mapping results.

Expected captured evidence: `{"kind":"error","messageIncludes":"map"}`

Acceptable explanation: The value used with map is not an array; inspect the response contract.

Relevant verification steps

- Check Array.isArray on the renderer input.
- Test object-shaped and array-shaped responses.

## BC-017 · Title disappears after an update

Category: state reducer

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: A reducer mutates state but forgets to return it, so the caller stores undefined.

Expected behavior: Keep a valid state object after the update.

Expected captured evidence: `{"kind":"error","messageIncludes":"undefined"}`

Acceptable explanation: State may have become undefined after an update; inspect reducer return paths.

Relevant verification steps

- Assert the reducer returns a state for every action.
- Inspect state immediately after the reducer call.

## BC-018 · Date formatting crashes

Category: date validation

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: An invalid Date is sent to toISOString without checking validity.

Expected behavior: Display validation feedback for an invalid date.

Expected captured evidence: `{"kind":"error","messageIncludes":"Invalid time value"}`

Acceptable explanation: The date conversion received an invalid time; inspect parsing and validation.

Relevant verification steps

- Check date.getTime() for NaN before formatting.
- Test missing and malformed date input.

## BC-019 · Preferences cannot be opened

Category: stored data

Reproduction steps

1. Open the fixture with synthetic invalid preferences
2. Click Run once

Known cause: A corrupt local preference string is parsed without fallback handling.

Expected behavior: Recover to default preferences.

Expected captured evidence: `{"kind":"error","messageIncludes":"JSON"}`

Acceptable explanation: Stored JSON may be malformed; inspect parsing and fallback behavior.

Relevant verification steps

- Clear only the synthetic preference key and retry.
- Add a corrupt-preference test.

## BC-020 · Spinner remains forever

Category: swallowed error

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: The error is caught and ignored, and the loading state is never cleared.

Expected behavior: Clear loading and show the error.

Expected captured evidence: `{"state":"Loading"}`

Acceptable explanation: Several async/finally or render failures fit this symptom; absent error evidence should be acknowledged.

Relevant verification steps

- Inspect catch and finally paths.
- Add logging around request completion and loading updates.

## BC-021 · Numeric results appear in the wrong order

Category: sorting

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: Array.sort uses lexicographic comparison because the numeric comparator is missing.

Expected behavior: Display 1,3,20.

Expected captured evidence: `{"state":"1,20,3"}`

Acceptable explanation: A comparator or type issue is plausible, but logs alone cannot confirm it.

Relevant verification steps

- Inspect the sort comparator and input types.
- Test numbers with differing digit lengths.

## BC-022 · Balance is reported as nonzero

Category: numeric precision

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: Strict equality is used after floating-point decimal arithmetic.

Expected behavior: Treat the mathematically zero balance as zero.

Expected captured evidence: `{"state":"nonzero"}`

Acceptable explanation: Numeric precision or rounding may explain the result; inspect actual values and units.

Relevant verification steps

- Inspect the result of0.1+0.2-0.3.
- Use a defined rounding policy or integer minor units in a test.

## BC-023 · Visible action does nothing

Category: detached event binding

Reproduction steps

1. Open the fixture
2. Click the visible Run button

Known cause: The handler is attached to a detached clone instead of the visible button.

Expected behavior: Display Done.

Expected captured evidence: `{"state":"Idle"}`

Acceptable explanation: An event binding or UI condition may prevent the action; request handler evidence.

Relevant verification steps

- Check the visible node has the intended listener.
- Compare the bound node with the clicked node.

## BC-024 · Closing a panel causes a delayed crash

Category: async DOM lifecycle

Reproduction steps

1. Open the fixture
2. Click Run to start the update and close the panel
3. Wait for the callback

Known cause: A delayed callback accesses a panel after it has been removed.

Expected behavior: Cancel the callback or verify the panel still exists.

Expected captured evidence: `{"kind":"error","messageIncludes":"null"}`

Acceptable explanation: DOM lifetime may race with delayed work; verify callback cleanup and node existence.

Relevant verification steps

- Close the panel before async completion.
- Inspect component cleanup and DOM lookup timing.

## BC-025 · Combined page load rejects

Category: parallel promise failure

Reproduction steps

1. Open the fixture
2. Click Run once

Known cause: Promise.all rejects when one branch fails and the aggregate rejection is unhandled.

Expected behavior: Handle a branch failure or display partial results deliberately.

Expected captured evidence: `{"kind":"unhandled-rejection","messageIncludes":"Recommendations unavailable"}`

Acceptable explanation: One async dependency failure aborts the combined operation; inspect aggregation and error handling.

Relevant verification steps

- Fail each dependency separately.
- Test Promise.all error handling and partial-result requirements.
