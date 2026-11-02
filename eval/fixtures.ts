export interface DefectFixture {
  id: string;
  category: string;
  symptom: string;
  reproductionSteps: string[];
  knownCause: string;
  expectedBehavior: string;
  expectedCapturedEvidence: {
    kind?: 'error' | 'console-error' | 'unhandled-rejection';
    messageIncludes?: string;
    state?: string;
  };
  acceptableExplanation: string;
  relevantVerificationSteps: string[];
  html?: string;
  script: string;
  clicks?: string[];
}

/** Oracle fields are used by assertions/review only, never by the model adapters. */
export const defectFixtures: DefectFixture[] = [
  {
    id: 'BC-001',
    category: 'undefined value',
    symptom: 'Profile action crashes',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'An optional profile is undefined, but the handler reads profile.name without a guard.',
    expectedBehavior: 'Display the profile name or a fallback.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'undefined' },
    acceptableExplanation:
      'An undefined object is dereferenced; absent profile data is one plausible source.',
    relevantVerificationSteps: [
      'Inspect the object immediately before the failing name read.',
      'Test the action with a missing profile.',
    ],
    script: `document.querySelector('#run').onclick=()=>{console.error('Profile request did not yield data');console.error('Profile request did not yield data');const profile=undefined;document.querySelector('#state').textContent=profile.name;};`,
  },
  {
    id: 'BC-002',
    category: 'DOM assumption',
    symptom: 'Panel update crashes',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'The selector targets an element that does not exist in the document.',
    expectedBehavior: 'Update an existing panel.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'null' },
    acceptableExplanation:
      'A DOM lookup may return null; verify element existence and render timing.',
    relevantVerificationSteps: [
      'Inspect the selector result at the reported script location.',
      'Test the view before the panel is mounted.',
    ],
    script: `document.querySelector('#run').onclick=()=>{document.querySelector('#missing-panel').textContent='Updated';};`,
  },
  {
    id: 'BC-003',
    category: 'data parsing',
    symptom: 'Configuration fails to load',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause: 'A trailing comma makes the configuration string invalid JSON.',
    expectedBehavior: 'Load the valid configuration.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'JSON' },
    acceptableExplanation:
      'JSON parsing failed; inspect the exact input rather than assuming a network failure.',
    relevantVerificationSteps: [
      'Inspect the string passed to JSON.parse.',
      'Add a malformed-configuration test.',
    ],
    script: `document.querySelector('#run').onclick=()=>{JSON.parse('{"enabled":true,}');};`,
  },
  {
    id: 'BC-004',
    category: 'promise rejection',
    symptom: 'Checkout never completes',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause: 'A rejected inventory promise has no catch handler.',
    expectedBehavior: 'Display a recoverable checkout error.',
    expectedCapturedEvidence: {
      kind: 'unhandled-rejection',
      messageIncludes: 'Inventory unavailable',
    },
    acceptableExplanation:
      'An inventory-related rejection escaped the checkout error handling.',
    relevantVerificationSteps: [
      'Trace the rejected promise to the checkout caller.',
      'Test the unavailable inventory path.',
    ],
    script: `document.querySelector('#run').onclick=()=>{document.querySelector('#state').textContent='Loading';void Promise.reject(new Error('Inventory unavailable'));};`,
  },
  {
    id: 'BC-005',
    category: 'async race',
    symptom: 'Search displays an older result',
    reproductionSteps: [
      'Open the fixture',
      'Click Run to issue old and new searches',
      'Wait for both responses',
    ],
    knownCause:
      'The slower old response overwrites the newer response because no request identity is checked.',
    expectedBehavior: 'Display new result.',
    expectedCapturedEvidence: { state: 'old result' },
    acceptableExplanation:
      'Out-of-order async completion is plausible; without network evidence it remains a hypothesis.',
    relevantVerificationSteps: [
      'Delay the first request and speed up the second.',
      'Record request IDs and completion order.',
    ],
    script: `document.querySelector('#run').onclick=()=>{setTimeout(()=>document.querySelector('#state').textContent='old result',45);setTimeout(()=>document.querySelector('#state').textContent='new result',5);};`,
  },
  {
    id: 'BC-006',
    category: 'missing await',
    symptom: 'Name formatting crashes',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'The formatter receives a Promise instead of the awaited string.',
    expectedBehavior: 'Display the uppercase name.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'toUpperCase' },
    acceptableExplanation:
      'The value is not the expected string; a missing await is a plausible explanation.',
    relevantVerificationSteps: [
      'Inspect the value and typeof before formatting.',
      'Check the async API return contract.',
    ],
    script: `document.querySelector('#run').onclick=()=>{const name=Promise.resolve('Ada');document.querySelector('#state').textContent=name.toUpperCase();};`,
  },
  {
    id: 'BC-007',
    category: 'stale closure',
    symptom: 'Counter displays the previous value',
    reproductionSteps: [
      'Open the fixture',
      'Click Run once',
      'Wait for the render callback',
    ],
    knownCause: 'A callback closes over a snapshot before the state increment.',
    expectedBehavior: 'Display 1.',
    expectedCapturedEvidence: { state: '0' },
    acceptableExplanation:
      'The rendered count may use stale captured state; no exception alone proves the mechanism.',
    relevantVerificationSteps: [
      'Inspect which value the scheduled callback captures.',
      'Test two rapid increments.',
    ],
    script: `let count=0;document.querySelector('#run').onclick=()=>{const snapshot=count;count++;setTimeout(()=>document.querySelector('#state').textContent=String(snapshot),5);};`,
  },
  {
    id: 'BC-008',
    category: 'state mutation',
    symptom: 'List count does not refresh',
    reproductionSteps: ['Open the fixture', 'Click Run to add an item'],
    knownCause:
      'In-place mutation preserves object identity, causing the render guard to skip the update.',
    expectedBehavior: 'Display 1 item.',
    expectedCapturedEvidence: { state: '0 items' },
    acceptableExplanation:
      'A skipped state/render update is plausible; inspect state identity and subscriptions.',
    relevantVerificationSteps: [
      'Compare old and new state references.',
      'Replace mutation with a new array in a focused test.',
    ],
    script: `let items=[];const rendered=items;document.querySelector('#state').textContent='0 items';document.querySelector('#run').onclick=()=>{items.push('item');if(items!==rendered)document.querySelector('#state').textContent=items.length+' items';};`,
  },
  {
    id: 'BC-009',
    category: 'duplicate listener',
    symptom: 'One click adds two items',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'The same logical action is registered through two separate listener functions.',
    expectedBehavior: 'Display 1.',
    expectedCapturedEvidence: { state: '2' },
    acceptableExplanation:
      'The action may execute twice; distinguish duplicate handlers from duplicate requests.',
    relevantVerificationSteps: [
      'Count handler invocations for one click.',
      'Inspect mount/unmount listener registration.',
    ],
    script: `let count=0;const add=()=>document.querySelector('#state').textContent=String(++count);document.querySelector('#run').addEventListener('click',()=>add());document.querySelector('#run').addEventListener('click',()=>add());`,
  },
  {
    id: 'BC-010',
    category: 'event target',
    symptom: 'Clicking the button icon crashes',
    reproductionSteps: ['Open the fixture', 'Click the icon inside Run'],
    knownCause:
      'The handler reads data from event.target, which is the nested icon, rather than currentTarget.',
    expectedBehavior: 'Display ITEM.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'toUpperCase' },
    acceptableExplanation:
      'Nested click targets may lack the expected property; inspect target versus currentTarget.',
    relevantVerificationSteps: [
      'Click the text and child icon separately.',
      'Inspect event.target and currentTarget at the handler.',
    ],
    html: '<button id="run" data-item="item">Run <span id="icon">icon</span></button><output id="state">Idle</output>',
    clicks: ['#icon'],
    script: `document.querySelector('#run').onclick=(event)=>{document.querySelector('#state').textContent=event.target.dataset.item.toUpperCase();};`,
  },
  {
    id: 'BC-011',
    category: 'receiver binding',
    symptom: 'Opening the card crashes',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'A detached class method loses its instance receiver when called as a plain function.',
    expectedBehavior: 'Display the card label.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'undefined' },
    acceptableExplanation:
      'A missing method receiver can cause an undefined-property read; verify call binding.',
    relevantVerificationSteps: [
      'Inspect this inside the failing method.',
      'Test a bound callback.',
    ],
    script: `class Card{constructor(){this.label='Card';}open(){return this.label.toUpperCase();}}const open=new Card().open;document.querySelector('#run').onclick=()=>{document.querySelector('#state').textContent=open();};`,
  },
  {
    id: 'BC-012',
    category: 'event lifecycle',
    symptom: 'Action works only once',
    reproductionSteps: ['Open the fixture', 'Click Run twice'],
    knownCause:
      'The click listener was configured with once:true for an action intended to repeat.',
    expectedBehavior: 'Display 2 after two clicks.',
    expectedCapturedEvidence: { state: '1' },
    clicks: ['#run', '#run'],
    acceptableExplanation:
      'Listener removal or one-shot registration is plausible; inspect the event lifecycle.',
    relevantVerificationSteps: [
      'Check listener registration options.',
      'Add a repeated-action regression test.',
    ],
    script: `let count=0;document.querySelector('#run').addEventListener('click',()=>document.querySelector('#state').textContent=String(++count),{once:true});`,
  },
  {
    id: 'BC-013',
    category: 'response parsing',
    symptom: 'Data panel fails after a response',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause: 'The caller tries to parse an HTML error page as JSON.',
    expectedBehavior: 'Validate the response and show a recoverable error.',
    expectedCapturedEvidence: {
      kind: 'unhandled-rejection',
      messageIncludes: 'JSON',
    },
    acceptableExplanation:
      'The response format may differ from JSON; check content type and body.',
    relevantVerificationSteps: [
      'Inspect response content type before parsing.',
      'Test an HTML server-error response.',
    ],
    script: `document.querySelector('#run').onclick=async()=>{const response=new Response('<html>Error</html>',{headers:{'content-type':'text/html'}});await response.json();};`,
  },
  {
    id: 'BC-014',
    category: 'HTTP status',
    symptom: 'Products fail to render',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'The caller ignores a mocked404 status and assumes the error body contains an items array.',
    expectedBehavior: 'Handle404 before rendering products.',
    expectedCapturedEvidence: {
      kind: 'unhandled-rejection',
      messageIncludes: 'map',
    },
    acceptableExplanation:
      'An error response may have the wrong data shape; the recorded404 is relevant evidence.',
    relevantVerificationSteps: [
      'Check response.ok and status handling.',
      'Test a404 body without items.',
    ],
    script: `document.querySelector('#run').onclick=async()=>{const response=new Response('{"error":"not found"}',{status:404});console.error('Product response status',response.status);const data=await response.json();data.items.map(item=>item.name);};`,
  },
  {
    id: 'BC-015',
    category: 'network failure',
    symptom: 'Load action stays pending',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause: 'A synthetic fetch rejection is not caught by the action.',
    expectedBehavior: 'Show an offline/retry state.',
    expectedCapturedEvidence: {
      kind: 'unhandled-rejection',
      messageIncludes: 'Failed to fetch',
    },
    acceptableExplanation:
      'The observed fetch failure needs handling; it does not prove a particular server or CORS cause.',
    relevantVerificationSteps: [
      'Simulate an offline failure.',
      'Inspect the catch/finally path and network details separately.',
    ],
    script: `document.querySelector('#run').onclick=async()=>{document.querySelector('#state').textContent='Loading';const fakeFetch=()=>Promise.reject(new TypeError('Failed to fetch'));await fakeFetch();};`,
  },
  {
    id: 'BC-016',
    category: 'data contract',
    symptom: 'Results rendering crashes',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'The API result is an object, but the renderer expects an array.',
    expectedBehavior: 'Validate the shape before mapping results.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'map' },
    acceptableExplanation:
      'The value used with map is not an array; inspect the response contract.',
    relevantVerificationSteps: [
      'Check Array.isArray on the renderer input.',
      'Test object-shaped and array-shaped responses.',
    ],
    script: `document.querySelector('#run').onclick=()=>{const results={items:[]};results.map(item=>item.name);};`,
  },
  {
    id: 'BC-017',
    category: 'state reducer',
    symptom: 'Title disappears after an update',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'A reducer mutates state but forgets to return it, so the caller stores undefined.',
    expectedBehavior: 'Keep a valid state object after the update.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'undefined' },
    acceptableExplanation:
      'State may have become undefined after an update; inspect reducer return paths.',
    relevantVerificationSteps: [
      'Assert the reducer returns a state for every action.',
      'Inspect state immediately after the reducer call.',
    ],
    script: `let state={title:'Before'};function reduce(value){value.title='After';}document.querySelector('#run').onclick=()=>{state=reduce(state);document.querySelector('#state').textContent=state.title;};`,
  },
  {
    id: 'BC-018',
    category: 'date validation',
    symptom: 'Date formatting crashes',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'An invalid Date is sent to toISOString without checking validity.',
    expectedBehavior: 'Display validation feedback for an invalid date.',
    expectedCapturedEvidence: {
      kind: 'error',
      messageIncludes: 'Invalid time value',
    },
    acceptableExplanation:
      'The date conversion received an invalid time; inspect parsing and validation.',
    relevantVerificationSteps: [
      'Check date.getTime() for NaN before formatting.',
      'Test missing and malformed date input.',
    ],
    script: `document.querySelector('#run').onclick=()=>{document.querySelector('#state').textContent=new Date('not-a-date').toISOString();};`,
  },
  {
    id: 'BC-019',
    category: 'stored data',
    symptom: 'Preferences cannot be opened',
    reproductionSteps: [
      'Open the fixture with synthetic invalid preferences',
      'Click Run once',
    ],
    knownCause:
      'A corrupt local preference string is parsed without fallback handling.',
    expectedBehavior: 'Recover to default preferences.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'JSON' },
    acceptableExplanation:
      'Stored JSON may be malformed; inspect parsing and fallback behavior.',
    relevantVerificationSteps: [
      'Clear only the synthetic preference key and retry.',
      'Add a corrupt-preference test.',
    ],
    script: `localStorage.setItem('benchmark-preferences','{invalid');document.querySelector('#run').onclick=()=>{JSON.parse(localStorage.getItem('benchmark-preferences'));};`,
  },
  {
    id: 'BC-020',
    category: 'swallowed error',
    symptom: 'Spinner remains forever',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'The error is caught and ignored, and the loading state is never cleared.',
    expectedBehavior: 'Clear loading and show the error.',
    expectedCapturedEvidence: { state: 'Loading' },
    acceptableExplanation:
      'Several async/finally or render failures fit this symptom; absent error evidence should be acknowledged.',
    relevantVerificationSteps: [
      'Inspect catch and finally paths.',
      'Add logging around request completion and loading updates.',
    ],
    script: `document.querySelector('#run').onclick=async()=>{document.querySelector('#state').textContent='Loading';try{await Promise.reject(new Error('Hidden failure'));}catch{/* intentional bug */}};`,
  },
  {
    id: 'BC-021',
    category: 'sorting',
    symptom: 'Numeric results appear in the wrong order',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'Array.sort uses lexicographic comparison because the numeric comparator is missing.',
    expectedBehavior: 'Display 1,3,20.',
    expectedCapturedEvidence: { state: '1,20,3' },
    acceptableExplanation:
      'A comparator or type issue is plausible, but logs alone cannot confirm it.',
    relevantVerificationSteps: [
      'Inspect the sort comparator and input types.',
      'Test numbers with differing digit lengths.',
    ],
    script: `document.querySelector('#run').onclick=()=>{document.querySelector('#state').textContent=[1,20,3].sort().join(',');};`,
  },
  {
    id: 'BC-022',
    category: 'numeric precision',
    symptom: 'Balance is reported as nonzero',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'Strict equality is used after floating-point decimal arithmetic.',
    expectedBehavior: 'Treat the mathematically zero balance as zero.',
    expectedCapturedEvidence: { state: 'nonzero' },
    acceptableExplanation:
      'Numeric precision or rounding may explain the result; inspect actual values and units.',
    relevantVerificationSteps: [
      'Inspect the result of0.1+0.2-0.3.',
      'Use a defined rounding policy or integer minor units in a test.',
    ],
    script: `document.querySelector('#run').onclick=()=>{document.querySelector('#state').textContent=(0.1+0.2-0.3)===0?'zero':'nonzero';};`,
  },
  {
    id: 'BC-023',
    category: 'detached event binding',
    symptom: 'Visible action does nothing',
    reproductionSteps: ['Open the fixture', 'Click the visible Run button'],
    knownCause:
      'The handler is attached to a detached clone instead of the visible button.',
    expectedBehavior: 'Display Done.',
    expectedCapturedEvidence: { state: 'Idle' },
    acceptableExplanation:
      'An event binding or UI condition may prevent the action; request handler evidence.',
    relevantVerificationSteps: [
      'Check the visible node has the intended listener.',
      'Compare the bound node with the clicked node.',
    ],
    script: `const clone=document.querySelector('#run').cloneNode(true);clone.onclick=()=>document.querySelector('#state').textContent='Done';`,
  },
  {
    id: 'BC-024',
    category: 'async DOM lifecycle',
    symptom: 'Closing a panel causes a delayed crash',
    reproductionSteps: [
      'Open the fixture',
      'Click Run to start the update and close the panel',
      'Wait for the callback',
    ],
    knownCause:
      'A delayed callback accesses a panel after it has been removed.',
    expectedBehavior: 'Cancel the callback or verify the panel still exists.',
    expectedCapturedEvidence: { kind: 'error', messageIncludes: 'null' },
    acceptableExplanation:
      'DOM lifetime may race with delayed work; verify callback cleanup and node existence.',
    relevantVerificationSteps: [
      'Close the panel before async completion.',
      'Inspect component cleanup and DOM lookup timing.',
    ],
    script: `const panel=document.createElement('div');panel.id='panel';document.body.append(panel);document.querySelector('#run').onclick=()=>{setTimeout(()=>document.querySelector('#panel').textContent='Done',10);panel.remove();};`,
  },
  {
    id: 'BC-025',
    category: 'parallel promise failure',
    symptom: 'Combined page load rejects',
    reproductionSteps: ['Open the fixture', 'Click Run once'],
    knownCause:
      'Promise.all rejects when one branch fails and the aggregate rejection is unhandled.',
    expectedBehavior:
      'Handle a branch failure or display partial results deliberately.',
    expectedCapturedEvidence: {
      kind: 'unhandled-rejection',
      messageIncludes: 'Recommendations unavailable',
    },
    acceptableExplanation:
      'One async dependency failure aborts the combined operation; inspect aggregation and error handling.',
    relevantVerificationSteps: [
      'Fail each dependency separately.',
      'Test Promise.all error handling and partial-result requirements.',
    ],
    script: `document.querySelector('#run').onclick=async()=>{await Promise.all([Promise.resolve('profile'),Promise.reject(new Error('Recommendations unavailable'))]);};`,
  },
];
