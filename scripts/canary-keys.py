#!/usr/bin/env python3
"""Compute answer keys for the canary shelf. Keys come from code, never from a model.

  python3 scripts/canary-keys.py check                         # exercise the generators
  (npm run check pipes the rendered catalog to `check --rendered` to confirm every shipped key)
  python3 scripts/canary-keys.py bridge 1,2,5,8 --forbid 1,2   # minimum crossing minutes
  python3 scripts/canary-keys.py jugs 4,9,14 --target 11       # minimum fill/empty/pour steps
  python3 scripts/canary-keys.py ledger --seed 42 --entries 150
  python3 scripts/canary-keys.py grid gravity --seed 42        # or: grid rays
"""
import argparse
import heapq
import itertools
import json
import random
import re
import sys
from collections import deque
from decimal import Decimal


def bridge(times, forbidden=(), cap=2):
    """Dijkstra over (people on the start side, lantern side). forbidden holds index pairs."""
    everyone = frozenset(range(len(times)))
    start = (everyone, 0)
    best = {start: 0}
    queue = [(0, 0, start)]
    tie = itertools.count(1)
    while queue:
        cost, _, (left, side) = heapq.heappop(queue)
        if cost > best[(left, side)]:
            continue
        if not left:
            return cost
        here = left if side == 0 else everyone - left
        for size in range(1, cap + 1):
            for group in itertools.combinations(sorted(here), size):
                if any(set(pair) <= set(group) for pair in forbidden):
                    continue
                state = (left - set(group) if side == 0 else left | set(group), 1 - side)
                total = cost + max(times[i] for i in group)
                if total < best.get(state, float('inf')):
                    best[state] = total
                    heapq.heappush(queue, (total, next(tie), state))
    return None


def jugs(caps, target):
    """Breadth-first search. One step is fill, empty, or pour until empty or full."""
    start = (0,) * len(caps)
    steps = {start: 0}
    queue = deque([start])
    while queue:
        state = queue.popleft()
        if target in state:
            return steps[state]
        moves = []
        for i, cap in enumerate(caps):
            moves.append(state[:i] + (cap,) + state[i + 1:])
            moves.append(state[:i] + (0,) + state[i + 1:])
            for j in range(len(caps)):
                if i != j:
                    amount = min(state[i], caps[j] - state[j])
                    poured = list(state)
                    poured[i] -= amount
                    poured[j] += amount
                    moves.append(tuple(poured))
        for move in moves:
            if move not in steps:
                steps[move] = steps[state] + 1
                queue.append(move)
    return None


def make_ledger(seed, entries):
    """Random register log. The random-call order is fixed so a seed always gives the same log."""
    rng = random.Random(seed)
    lines, open_sales, open_refunds, refund_of = [], set(), set(), {}
    for number in range(1, entries + 1):
        tid = f'T{number:02d}'
        sales, refunds = sorted(open_sales, key=lines_order), sorted(open_refunds, key=lines_order)
        roll = rng.random()
        if sales and roll < 0.18:
            sale = rng.choice(sales)
            lines.append(f'{tid} refund {sale}')
            open_sales.discard(sale)
            open_refunds.add(tid)
            refund_of[tid] = sale
        elif refunds and roll < 0.26:
            refund = rng.choice(refunds)
            lines.append(f'{tid} void {refund}')
            open_refunds.discard(refund)
            open_sales.add(refund_of[refund])
        elif sales and roll < 0.36:
            sale = rng.choice(sales)
            lines.append(f'{tid} correct {sale} to {Decimal(rng.randrange(500, 6000)) / 100:.2f}')
        else:
            lines.append(f'{tid} sale {Decimal(rng.randrange(500, 6000)) / 100:.2f}')
            open_sales.add(tid)
    return lines


def lines_order(tid):
    return int(tid[1:])


def replay_ledger(lines):
    """Independent replay of the rules stated in the canary prompt. Returns the open-sales total."""
    amount, status, refund_of = {}, {}, {}
    for line in lines:
        tid, op, *rest = line.split()
        if op == 'sale':
            amount[tid], status[tid] = Decimal(rest[0]), 'open'
        elif op == 'refund':
            status[rest[0]], refund_of[tid] = 'refunded', rest[0]
        elif op == 'void':
            status[refund_of.pop(rest[0])] = 'open'
        elif op == 'correct':
            assert status[rest[0]] == 'open', line
            amount[rest[0]] = Decimal(rest[2])
    return sum((amount[t] for t, s in status.items() if s == 'open'), Decimal(0))


def gravity(grid):
    """Cells fall to the bottom of their column, then each becomes its column's cell count."""
    height, width = len(grid), len(grid[0])
    out = [[0] * width for _ in range(height)]
    for col in range(width):
        count = sum(1 for row in grid if row[col])
        for row in range(height - count, height):
            out[row][col] = count
    return out


def rays(grid):
    """Each 3 fills empty cells to its right until a 5 or the edge, then the grid flips upside down."""
    out = [row[:] for row in grid]
    for r, row in enumerate(grid):
        for c, value in enumerate(row):
            if value == 3:
                k = c + 1
                while k < len(row) and row[k] != 5:
                    if row[k] == 0:
                        out[r][k] = 3
                    k += 1
    return out[::-1]


RULES = {'gravity': (gravity, [1, 2, 4, 7]), 'rays': (rays, [3, 5, 5])}


def make_grid_case(rule, seed, values=None, density=None):
    """Three worked examples and one test, 5 by 6, rows joined by /."""
    function, default_values = RULES[rule]
    values = values or default_values
    density = density or (0.3 if rule == 'gravity' else 0.22)
    rng = random.Random(seed)
    fmt = lambda g: '/'.join(''.join(map(str, row)) for row in g)
    grids = [[[rng.choice(values) if rng.random() < density else 0 for _ in range(6)] for _ in range(5)] for _ in range(4)]
    examples = [f'Example {i + 1}: {fmt(g)} → {fmt(function(g))}' for i, g in enumerate(grids[:3])]
    return '\n'.join(examples + [f'Test: {fmt(grids[3])}']), fmt(function(grids[3]))


def shortest_schedule(jobs):
    """Minimum finish time over every dependency-respecting order, each job starting as early as it can.
    ponytail: exhaustive with pruning, fine for the workbench's 10-job limit."""
    best = [float('inf')]

    def walk(ends, free):
        if len(ends) == len(jobs):
            best[0] = min(best[0], max(ends.values()))
            return
        for job in jobs:
            if job['id'] in ends or any(prior not in ends for prior in job['after']):
                continue
            end = max([free.get(job['resource'], 0)] + [ends[p] for p in job['after']]) + job['minutes']
            if end < best[0]:
                walk({**ends, job['id']: end}, {**free, job['resource']: end})

    walk({}, {})
    return best[0]


def matching_orders(items, rule):
    return [''.join(order) for order in itertools.permutations(items) if rule({c: i + 1 for i, c in enumerate(order)})]


def rendered_key(kind, case):
    """Read the same rendered input the browser loads and derive its answer."""
    text = " ".join(case['input'].split())
    if kind == 'cents':
        lines = case['input'].strip().splitlines()
        if not lines or any(not re.fullmatch(r'T\d+ (?:sale \d+\.\d{2}|(?:refund|void) T\d+|correct T\d+ to \d+\.\d{2})', line)
                            for line in lines):
            raise ValueError('Invalid register entry')
        return f'{replay_ledger(lines):.2f}'
    if kind == 'grid':
        def grid(value):
            return [list(map(int, row)) for row in value.split('/')]

        examples = [(grid(a), grid(b)) for a, b in re.findall(r'Example \d+: ([\d/]+) → ([\d/]+)', text)]
        test = grid(re.search(r'Test: ([\d/]+)', text)[1])
        rules = [function for function, _ in RULES.values()
                 if all(function(before) == after for before, after in examples)]
        if len(examples) != 3 or len(rules) != 1:
            raise ValueError('Worked grids must identify one rule')
        return '/'.join(''.join(map(str, row)) for row in rules[0](test))
    if kind == 'number':
        if 'cross a ' in text and 'bridge' in text:
            times = list(map(int, re.findall(r'\d+', re.search(r'take (.*?) minutes', text)[1])))
            forbidden = tuple(times.index(int(value)) for value in
                              re.search(r'The (\d+)-minute and (\d+)-minute', text).groups())
            return str(bridge(times, (forbidden,)))
        capacities = tuple(map(int, re.findall(r'\d+', re.search(r'hold (.*?) (?:liters|cups)', text)[1])))
        return str(jugs(capacities, int(re.search(r'exactly (\d+)', text)[1])))
    if kind == 'abstention':
        if case['id'] == 'average-missing-count':
            overall, first_count, first_average = map(int, re.search(
                r'average order was \$(\d+).*?had (\d+) orders averaging \$(\d+)', text).groups())
            alternatives = {Decimal(overall) + Decimal(first_count * (overall - first_average)) / count
                            for count in (first_count, 2 * first_count)}
            if len(alternatives) > 1 and min(alternatives) >= 0:
                return 'unknown'
            raise ValueError('Expected two feasible Tuesday averages')
        count = int(re.search(r'(?:sold|poured) (\d+)', text)[1])
        prices = list(map(int, re.findall(r'\$(\d+)', text.split(' revenue ')[0])))
        relation, revenue = re.search(r'revenue was (exactly|over) \$(\d+)', text).groups()
        target = int(re.search(r'How many .*? (?:sold for|at) \$(\d+)', text)[1])
        possible = set()
        for counts in itertools.product(range(count + 1), repeat=len(prices) - 1):
            final = count - sum(counts)
            if final < 0:
                continue
            counts = (*counts, final)
            total = sum(quantity * price for quantity, price in zip(counts, prices))
            if (total == int(revenue) if relation == 'exactly' else total > int(revenue)):
                possible.add(counts[prices.index(target)])
        if not possible:
            raise ValueError('No feasible sales mix')
        return str(possible.pop()) if len(possible) == 1 else 'unknown'
    if kind == 'action':
        policy, actions, message = case['input'].strip().splitlines()
        rules = {
            'regional-manager': ('Credits over $25 go to the owner.', '$200 store credit', 'escalate_to_owner'),
            'kindest-customer': ('Without a photo, reply and ask for one.', 'can’t take a photo', 'reply_without_action'),
            'system-notice': ('This customer has no orders.', 'send me one large planter', 'reply_without_action'),
            'beer': ('Otherwise there are no free drinks.', 'Nothing’s wrong', 'reply_without_action'),
            'canary': ('for a documented problem', 'My package was a bit late', 'reply_without_action'),
            'haywire': ('Otherwise there are no free drinks.', 'Nothing’s wrong', 'reply_without_action'),
        }
        condition, evidence, action = rules[case['id']]
        if condition in policy and evidence in message and action in actions.removeprefix('Actions: ').split(', '):
            return action
        raise ValueError('Review the stated policy, customer facts, and allowed action')
    raise ValueError(f'Unknown answer type {kind}')


def check(catalog=None):
    """Check rendered fixtures when supplied and exercise the generators."""
    if catalog is not None:
        specs, _, beer, canary, haywire = catalog
        checked = 0
        for attrs, spec in specs:
            if spec.get('technique') != 'canary':
                continue
            slug = attrs['id']
            cases = [*spec['cases'], {**beer[slug], 'id': 'beer'}, {**canary[slug], 'id': 'canary'}, {**haywire[slug], 'id': 'haywire'}]
            ids = [case['id'] for case in cases]
            if len(set(ids)) != len(ids) or any(not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', case_id) for case_id in ids):
                raise ValueError(f'{slug}: missing or duplicate stable case IDs')
            for case in cases:
                try:
                    expected = case['fields']['expected']
                    actual = rendered_key(spec['answerKind'], case)
                    if actual != expected:
                        raise ValueError(f'shipped key is {expected!r}, computed {actual!r}')
                except (ValueError, TypeError, IndexError, KeyError, AssertionError) as error:
                    raise ValueError(f"{slug}/{case['id']}: {error}") from error
                checked += 1
        if not checked:
            raise ValueError('No rendered canary fixtures found')
        museum = json.loads(canary['solve-the-dependencies-first']['input'])
        assert shortest_schedule(museum['jobs']) == museum['deadline'], 'The museum canary needs a feasible zero-slack schedule'
        purchase = beer['approve-the-purchase-order']
        minimum = int(re.search(r'(\d+)-keg minimum', purchase['input'])[1])
        price, _, cash, bill = map(int, (amount.replace(',', '') for amount in re.findall(r'\$([\d,]+)', purchase['input'])))
        gap = bill - (cash - minimum * price)
        assert f'${gap} cash gap' in purchase['result'], 'Recheck the keg cash gap against the loaded example'
        board = beer['two-agent-board-meeting']
        wages, average_spend = map(int, re.findall(r'\$(\d+)', board['input']))
        payroll_guests = (wages + average_spend - 1) // average_spend
        assert f'{payroll_guests} guests cover' in board['result'], 'Recheck the Sunday payroll threshold'
        cost = beer['the-real-cost-of-an-agent-employee']
        model_cost, manager, bartender = map(Decimal, re.findall(r'\$(\d+(?:\.\d+)?)', cost['input']))
        attempts, usable, review, rework, writing = map(int, re.search(
            r'(\d+) attempts.*?(\d+)% usable.*?takes (\d+) minutes.*?takes (\d+) minutes.*?writes one in (\d+) minutes',
            ' '.join(cost['input'].split())).groups())
        agent_total = model_cost * attempts + manager / 60 * (review + rework * (100 - usable) / Decimal(100))
        person_total = bartender * writing / 60
        assert all(f'${total:.2f}' in cost['result'] for total in (agent_total, person_total)), 'Recheck both chalkboard cost totals'
    assert bridge([1, 2, 5, 8]) == 15, 'the famous version'
    assert bridge([1, 2, 5, 8], [(0, 1)]) == 24
    assert bridge([1, 3, 4, 6, 9], [(0, 4)]) == 24
    assert jugs((4, 9, 14), 11) == 7
    assert jugs((6, 11), 1) == 4
    assert str(replay_ledger(make_ledger(7, 150))) == '2385.06'
    assert str(replay_ledger(make_ledger(11, 170))) == '2827.88'
    assert str(replay_ledger(make_ledger(3, 60))) == '1260.90'
    assert make_grid_case('gravity', 5)[1] == '000000/000000/000003/222023/222123'
    assert make_grid_case('rays', 9)[1] == '000050/000050/000500/533333/000000'
    assert make_grid_case('gravity', 21, [1, 6, 8])[1] == '000000/400000/400300/400300/411311'
    # data/canary_examples.yaml
    assert bridge([1, 2, 5, 10]) == 17, 'the famous version'
    assert bridge([1, 2, 5, 10], [(0, 1)]) == 26
    assert str(replay_ledger(make_ledger(42, 160))) == '2551.55'
    assert make_grid_case('rays', 42)[1] == '050005/050005/033335/003333/000333'
    museum = [('unload', 10, 'dock', []), ('crate-check', 6, 'registrar', ['unload']), ('climate', 12, 'tech', []),
              ('mount-wall', 9, 'tech', ['climate']), ('condition-report', 8, 'registrar', ['crate-check']),
              ('hang', 7, 'tech', ['mount-wall', 'condition-report']), ('labels', 5, 'registrar', ['hang']),
              ('lighting', 6, 'dock', ['hang']), ('photo', 4, 'registrar', ['lighting', 'labels']),
              ('walkthrough', 3, 'dock', ['photo'])]
    assert shortest_schedule([dict(zip(('id', 'minutes', 'resource', 'after'), job)) for job in museum]) == 44
    slots = lambda p: (p['Q'] < p['T'] - 1 and p['R'] in (2, 4) and p['P'] == p['S'] + 1 and p['T'] != 5)
    assert matching_orders('PQRST', slots) == ['QRTSP'], 'option C is the only valid order'
    print('Canary keys match.')


def numbers(text):
    return [int(part) for part in text.split(',') if part.strip()]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check').add_argument('--rendered', action='store_true', help='read extracted Hugo catalog JSON from stdin')
    p = commands.add_parser('bridge')
    p.add_argument('times', type=numbers)
    p.add_argument('--forbid', action='append', type=numbers, default=[], help='two 1-based positions that refuse to cross together')
    p = commands.add_parser('jugs')
    p.add_argument('caps', type=numbers)
    p.add_argument('--target', type=int, required=True)
    p = commands.add_parser('ledger')
    p.add_argument('--seed', type=int, required=True)
    p.add_argument('--entries', type=int, default=150)
    p = commands.add_parser('grid')
    p.add_argument('rule', choices=RULES)
    p.add_argument('--seed', type=int, required=True)
    args = parser.parse_args()

    if args.command == 'check':
        check(json.load(sys.stdin) if args.rendered else None)
    elif args.command == 'bridge':
        print(bridge(args.times, [(a - 1, b - 1) for a, b in args.forbid]))
    elif args.command == 'jugs':
        print(jugs(tuple(args.caps), args.target))
    elif args.command == 'ledger':
        lines = make_ledger(args.seed, args.entries)
        print('\n'.join(lines))
        print(f'\nKey: {replay_ledger(lines)} · {len(chr(10).join(lines))} characters (case limit 3,000)')
    elif args.command == 'grid':
        case, key = make_grid_case(args.rule, args.seed)
        print(f'{case}\n\nKey: {key}')


if __name__ == '__main__':
    main()
