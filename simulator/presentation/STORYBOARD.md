# STOC presentation storyboard

English captions for visual intuition. Each finite example illustrates a proof mechanism; it is not a proof of the general lemma.

Paper SHA-256: `6d00eaf6757b84b65b0d6e4c85e5f8625e7446635a9b29af7f5d5adecf682e37`

## Lemma 1 — Flat level

Paper label: `lem:flat-anonymities`. Type: execution.

A full level without splits lets flow balance recover the class sizes.

1. **Four agents, two kinds of memory** (5 s): The three leaves have identical memories.
2. **A flat transition** (5 s): Each old class has exactly one child: no class splits.
3. **Count the same messages twice** (5 s): One leader sends three messages; each leaf receives one.
4. **The leader count fixes the scale** (5 s): Flow determines the proportions. One known leader fixes the sizes.

**Proof connection.** The star supplies a concrete full, flat level. Uniqueness is checked using only flow and the known leader count; the total is checked afterwards. The general lemma applies to every full, flat level.

**Checked facts.**

- All round graphs are strongly connected.
- Level 1 is full and flat in the final observer view.
- Exact flow plus leader equations have the unique solution (1, 3), before any total constraint.
- The oracle accepts 4 at round 7.

## Lemma 2 — Credit under refinement

Paper label: `lem:credit-refinement-split`. Type: execution.

Splitting a class can only spend credit: each child needs a representative.

1. **A class of five agents** (5 s): These nonleaders begin with the same memory.
2. **One representative is reserved** (5 s): The remaining four agents can carry credit.
3. **A split spends credit** (5 s): Two child classes now need two representatives.
4. **Equality leaves no room for a split** (5 s): On this star, equal credit preserves all three leaves in one child class.

**Proof connection.** The split uses candidate m=6 on a directed cycle; the equality example uses candidate m=4 on a star. Credits use observer-only true fiber sizes and candidate sizes from complete accepted audits, propagated backwards. Both examples satisfy the Step 1–4 hypotheses; the general inequality follows from disjoint refinement.

**Checked facts.**

- The accepted candidate is 6.
- The five-agent nonleader class splits into sizes 1 and 4.
- Credit falls from 4 to 0+3.
- On the star, one child preserves the three-agent fiber and its credit 2.

## Lemma 3 — Minimum-ratio closure

Paper label: `lem:minimum-ratio-closure-split`. Type: construction.

A closed smallest-ratio set cannot stop at a proper part of a strongly connected network.

1. **Try a proper smallest-ratio set** (5 s): Suppose only the leader class has the smallest ratio.
2. **An edge must leave** (5 s): Strong connectivity forces communication out of every proper nonempty set.
3. **The escaping edge breaks balance** (5 s): The trial counts only two destinations for three outgoing messages.
4. **Closure reaches the whole network** (5 s): With the checked flow equations, no larger-ratio or hidden class can lie beyond the set.

**Proof connection.** The first assignment is a deliberately invalid trial, not a C-engine decision. It illustrates the escaping-edge obstruction in the proof. The valid assignment is checked exactly and makes all classes minimum-ratio classes. The lemma also requires the stated parent/child fiber equality and checked flow equations.

**Checked facts.**

- The star is strongly connected and three arcs leave the trial minimum-ratio set.
- Trial ratios are 1 and 3/2, and the leader flow equation fails.
- The unique valid candidate sizes are 1 and 3, with common ratio 1.

## Lemma 4 — Credit loss

Paper label: `lem:credit-loss-split`. Type: execution.

Credit never increases; preserving it under the checked equations forces the correct size.

1. **Credit before refinement** (5 s): The leader and nonleader classes begin with four units of credit.
2. **Each split spends credit** (5 s): A new memory class needs one more reserved representative.
3. **Each split spends credit** (5 s): A new memory class needs one more reserved representative.
4. **No credit remains** (5 s): All six agents now have distinct memories.
5. **Equality at the true candidate** (5 s): The next level preserves credit. Here the candidate is the true size: six.

**Proof connection.** The illustrated credit values use the true candidate m=6 from a complete accepted audit. The stable transition is an example of the equality conclusion, not an empirical proof of it. In the general proof, minimum-ratio closure and leader accounting turn equality into m=n.

**Checked facts.**

- The accepted audit has m=n=6.
- Exact total credits at levels 0..6 are 4,3,2,1,0,0,0.
- Every level refines the previous one and the last two displayed partitions are identical.

## Lemma 5 — Tail exposure

Paper label: `lem:tail-exposure`. Type: execution.

Tracing influence backwards reveals at least one new agent per round until the network is exhausted.

1. **Look backwards from agent 0** (5 s): Start with the observer at round four.
2. **The causal support expands** (5 s): Each backward step adds an outside predecessor, until the whole network is included.
3. **The causal support expands** (5 s): Each backward step adds an outside predecessor, until the whole network is included.
4. **Every agent can affect the view** (5 s): Four backward steps expose all five agents in this cycle.

**Proof connection.** This directed cycle attains the causal-support growth bound exactly. Highlights show physical causal support, which is contained in the union of visible fibers; the two sets need not be equal in other networks.

**Checked facts.**

- The backward supports have sizes 1,2,3,4,5.
- Every support is contained in the observer's visible fibers at that level.
- The visible-fiber union satisfies the lemma's lower bound at every level.

## Lemma 6 — Fibers inside a proper subset

Paper label: `lem:forward-fibers`. Type: execution.

If already-contained fibers cannot send outside, each round must isolate a new nonleader fiber inside.

1. **Fix a proper set containing the leader** (5 s): At first, the nonleader fiber crosses the boundary of S.
2. **Another nonleader fiber enters the set** (5 s): The leader's message separates agent 1 from the outside agents.
3. **Another nonleader fiber enters the set** (5 s): One more round isolates agent 2. Both nonleader slots in S are now used.
4. **The assumption cannot last another round** (5 s): Agent 2 now belongs to an inside fiber, and its next message leaves S.

**Proof connection.** On this fixed cycle, S={0,1,2} contains its one leader. The hypothesis holds for exactly two rounds and fails in round 3, attaining h=|S|−ell. Fibers and S are external proof information.

**Checked facts.**

- S is proper and contains all leaders.
- The no-outgoing-arc hypothesis holds in rounds 1 and 2.
- Contained nonleader-fiber counts are 0,1,2.
- In round 3 the contained fiber {2} sends to agent 3 outside S.

## Lemma 7 — Short audit

Paper label: `lem:short-audit`. Type: execution.

With at least two leaders, every wrong size is rejected and the correct size is accepted one round earlier.

1. **A nonleader is already visible** (5 s): The special all-leaders test rejects two.
2. **Three agents are not enough** (5 s): The visible history has a missing child: reject the candidate.
3. **Four agents are not enough** (5 s): The view already contains more than four classes at one level.
4. **All five agents halt together** (5 s): With two leaders, the full audit succeeds one round before the core bound.

**Proof connection.** This is an actual sharp-algorithm trace for n=5 and ell=2. The displayed rejection reasons are agent 0's local decisions. All agents halt at round 8. The general proof uses tail exposure and the bound on fibers inside a proper subset.

**Checked facts.**

- Agent 0 rejects candidates 2,3,4 with the displayed reasons.
- At round 4, the visible level-1 fiber {2} has no visible child at level 2.
- At round 6, all five level-2 classes are visible, exceeding candidate 4.
- The accepted anchor and final level are both 4, with size and descendant count 1 at every node.
- Every agent outputs 5 and halts at round 8 = 2n−2.

## Lemma 8 — Two-center graph

Paper label: `lem:two-center-graph`. Type: construction.

Two centers keep the graph strongly connected while tightly controlling what the other agents receive.

1. **Two groups, two centers** (5 s): Choose z in U and z′ in W.
2. **Everyone can reach everyone** (5 s): Every other agent reaches z directly; z reaches U through z′.
3. **Many arcs, one sender's memory** (5 s): Each W agent receives two copies of z's old memory.
4. **Switch the allowed multiplicity** (5 s): With c = 1, W receives one copy and u's outdegree becomes two.

**Proof connection.** U={z,u}, W={w,z′}, ell=2. Both allowed multiplicities c=2 and c=1 are checked. This is the graph gadget used by the lower-bound pair, not a claim that these four agents already have matching histories.

**Checked facts.**

- Both c=1 and c=2 graphs are loopless and strongly connected.
- The noncenter u receives only one message from z′ and has outdegree ell/c.
- Every W agent receives c messages from z and has outdegree ell.

## Lemma 9 — Bounded compatible orders

Paper label: `lem:conp-bounded-orders`. Type: construction.

Keep the causal support, then change the population outside it.

1. **Only two agents have influenced the observer** (4.5 s): After one round, the four other agents are outside the causal support.
2. **Merge the hidden agents** (4.5 s): Keep every parallel arc and loop created by contraction.
3. **Insert one new hidden agent** (4.5 s): Subdivide an outgoing arc without changing what reaches the observer.
4. **Two small witnesses** (4.5 s): Different populations can explain exactly the same observation.

**Proof connection.** One round of a six-agent cycle is contracted to three agents and expanded to four. The exact observer signatures agree. The general proof bounds causal support and applies this construction round by round; this example does not enumerate the spectrum.

**Checked facts.**

- All three round graphs are strongly connected.
- Observer 0 has exactly the same canonical round-1 history at orders 6, 3, and 4.
- The two constructed orders are at most K + ell + 2 = 7.

## Lemma 10 — Eliminating a balanced auxiliary vertex

Paper label: `lem:conp-balanced-vertex`. Type: construction.

Switch shortcut pairings until all components join.

1. **Route everything through z** (4.5 s): The auxiliary vertex receives and sends the same number of arcs.
2. **A careless pairing can disconnect** (4.5 s): Pairing each incoming arc with its own return creates three isolated loops.
3. **Swap two shortcuts** (4.5 s): Cross the pairings to join two components while preserving all degrees.
4. **Repeat until connected** (4.5 s): One more switch produces a directed cycle on the original vertices.

**Proof connection.** A three-leaf bidirected star supplies a concrete balanced auxiliary vertex. Each pairing preserves every real vertex's degrees. The switches preserve old reachability and merge components, illustrating the general switching proof.

**Checked facts.**

- The auxiliary vertex has equal indegree and outdegree and no loop.
- All shortcut stages preserve the real vertices' in- and outdegrees.
- The component count falls from 3 to 2 to 1 without losing reachability.

## Lemma 11 — Realizing a transition

Paper label: `lem:conp-transition`. Type: construction.

Balanced class-level requirements can be wired into a real round.

1. **Start from class requirements** (4.5 s): Every agent needs one message from the opposite class.
2. **Balance supply and demand** (4.5 s): Each class supplies two arcs, exactly matching the two required receipts.
3. **Introduce balanced auxiliaries** (4.5 s): Route outgoing capacity through one auxiliary vertex per old class.
4. **Remove the auxiliaries** (4.5 s): Shortcut the paths to obtain one strongly connected communication round.

**Proof connection.** This four-agent instance satisfies positive degrees, exact flow balance, and a strongly connected class digraph. Removing the two balanced auxiliary vertices gives the displayed round. The lemma establishes sufficiency for arbitrary binary-encoded class tables.

**Checked facts.**

- Both old fibers have outgoing flow 2 and required incoming-target flow 2.
- Every agent has outdegree 1 and receives one state from the opposite old fiber.
- The resulting four-agent graph is strongly connected.

## Lemma 12 — Small full prefix

Paper label: `lem:conp-normal-form`. Type: construction.

Simplify hidden histories while keeping the observer's vista fixed.

1. **Hidden histories need not be preserved** (4.5 s): The observer sees one incoming nonleader state; hidden agents may have many different histories.
2. **Route hidden traffic through q** (4.5 s): Keep the observer's incoming arc and outdegree exactly as before.
3. **Hidden agents share a signature** (4.5 s): Four agents now have the same degree and incoming history, so they form one block.
4. **A smaller description of the same observation** (4.5 s): The network keeps its size, but its full history table becomes simpler.

**Proof connection.** This is one normalization transition: all six physical agents and the leader are retained. Visible incoming records and outdegrees are unchanged; four hidden histories become one block. The general lemma repeats the construction at every level and bounds encoding length.

**Checked facts.**

- The original and normalized six-agent graphs are strongly connected.
- Observer 0 has the same canonical round-1 vista in both graphs.
- Six level-1 histories become exactly three, with fibers {0}, {5}, and {1,2,3,4}.
- The displayed degree labels 7 and 9 and the lemma's level bound are satisfied.

## Lemma 13 — Fixed-order certificates

Paper label: `lem:conp-fixed-order`. Type: construction.

Verify a compact history table instead of listing a large execution.

1. **A concrete four-agent realization** (4.5 s): A certificate records groups of equal histories, not one row per physical agent.
2. **Check the full history table** (4.5 s): The nonleader parent splits into fibers of one and two agents.
3. **Check flow and the observer's closure** (4.5 s): Every required receipt is supplied, and the selected bottom node exposes exactly the input vista.
4. **A wrong entry is detectable** (4.5 s): Changing one fiber size breaks conservation and the claimed network order.

**Proof connection.** The illustrated table is a complete one-round certificate for a four-agent cycle. It checks conservation, leader count, exact flows, distinct signatures, realizability, and the terminal backward closure. The lemma's polynomial-size statement is general, not inferred from this small certificate.

**Checked facts.**

- The full table matches the independent oracle's partition and labels.
- Positive anonymities, totals, leader count, parent conservation, flow, distinct siblings, and class connectivity pass.
- The observer's backward closure has exactly the displayed input vista.
- Changing the size of B from 2 to 3 is rejected.

## Lemma 14 — One reference solution, or an exact cover

Paper label: `lem:conp-digits`. Type: construction.

Use carry-free digits to make overlap and omissions visible.

1. **An exact cover touches every element once** (4.5 s): Two disjoint triples cover all six elements.
2. **Overlap leaves a visible mismatch** (4.5 s): Replacing S2 by S3 covers one element twice and leaves one uncovered.
3. **Pack the coverage into digits** (4.5 s): Use one digit per element. The base is large enough that counts cannot carry.
4. **Exactly two ways to hit the target** (4.5 s): The single reference choice and the exact cover have the same encoded weight.

**Proof connection.** The X3C instance has six elements and three triples. The exact paper encoding uses base 5; all nonnegative coordinate vectors with sum at most 2 are checked. Its only solutions are the reference choice and the unique exact cover S1,S2. No claim about arbitrary instances is inferred from this enumeration.

**Checked facts.**

- The exact paper coefficients are 35156, 15656, 19500, and 16376.
- Exhaustive enumeration within the proved coordinate bound gives exactly two solutions.
- S1 and S2 cover every element once; S1 and S3 overlap and omit elements.
- All element digits are at most 2, strictly below base 5, so no carries occur.

## Lemma 15 — Common path prefix

Paper label: `lem:conp-path-prefix`. Type: construction.

A path reveals one new position per round while hiding its remaining length.

1. **Path prefix · round 1** (4.5 s): The first position separates; every later position still has the same history.
2. **Path prefix · round 2** (4.5 s): One more position becomes distinguishable in each network.
3. **Path prefix · round 3** (4.5 s): The split moves along the path, one round at a time.
4. **Path prefix · round 4** (4.5 s): The same labeled classes remain, even though their suffix fibers have different sizes.

**Proof connection.** Both full constructions use the exact coefficients from Lemma 14 and equal leader outdegree 468596. Only group 0 is expanded in the drawing. Canonical signatures of every full history level agree through round 4; physical fiber sizes intentionally differ. The final graphs are also exported and reproduce the reference leader's round-5 vista.

**Checked facts.**

- The reference and alternative orders are 22 and 23, with the same leader outdegree 468596.
- Every group splits into r singleton classes and one suffix after rounds r=1,2,3,4.
- The complete labeled history prefixes, ignoring fiber sizes, have equal canonical signature sets.
- Both final-round leader vistas agree, and every round graph is strongly connected.

## Lemma 16 — The first visible level is full

Paper label: `lem:conp-first-full`. Type: construction.

Hidden agents would force more losses than the visible support can afford.

1. **Only two agents of slack** (4.5 s): The first visible level can contain at most 23 agents; the last needs at least 21.
2. **An unseen agent forces a loss** (4.5 s): Strong connectivity makes every proper visible support shrink at the next level.
3. **The slack is exhausted** (4.5 s): After two strict decreases, only the required minimum remains.
4. **One more decrease is impossible** (4.5 s): Three losses exceed the two-agent slack. The first visible level must be full.

**Proof connection.** For the same q=2 instance, the initial visible support has size at most 23 and level 4 needs at least 21 agents. Assuming an unseen agent forces three strict decreases, leaving at most 20: a contradiction. The oracle separately confirms fullness in the two explicit realizations, while the support argument applies to every compatible realization.

**Checked facts.**

- The construction has R=21, q=2, B=5, so the initial slack is at most 2.
- There are exactly B-2=3 transitions, forcing a hypothetical bound of 20 < 21.
- The reference and alternative final leader vistas have identical canonical signatures.
- Their first visible levels contain all 22 and all 23 agents, respectively.

## Bonus: lower bound — Different sizes, identical leader views

Paper label: `thm:several-leader-vista`. Type: construction.

Four and five agents can keep designated leaders indistinguishable through round five.

1. **The same start in different-sized networks** (5 s): Both networks have two leaders, but one has an extra nonleader.
2. **Hide differences behind a matching old message** (5 s): A new center sends its old matching memory before learning its new information.
3. **The second phase preserves the observers** (5 s): The designated leaders still see identical histories.
4. **Repeat one fixed final cycle** (5 s): The relay delays the difference: the leader views still match through round five.
5. **The first difference finally arrives** (5 s): At round six the leader views diverge. Before then, the sizes were indistinguishable.

**Proof connection.** This appendix construction uses n=4, ell=2 and one relay on each side. The two passive full-history traces are compared by complete canonical recursive signatures, not by numeric node IDs. The fixed final cycle is included and repeated; the first difference is at round 6. This illustrates Theorem 4 rather than an additional lemma.

**Checked facts.**

- All graphs are loopless and strongly connected, with multiplicity at most 2 and outdegree at most 4.
- Both scenarios repeat their final directed cycle.
- Complete designated-leader signatures agree at every round 0..5 and differ at round 6.
