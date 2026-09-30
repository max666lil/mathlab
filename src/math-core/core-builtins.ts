/** Core value constructors and linear-algebra builtins. */
import { registerBuiltin, expectNumber, expectVector, expectMatrix, EvalError, Builtin } from './builtins';
import { scalar, point, vector, matrixV, MathValue, VectorValue } from './values';
import { normalize as normV, norm, dot, cross, det, transpose, symmetricEigen } from './linalg';

const nums = (args: (MathValue | undefined)[]) => args.map((a) => expectNumber(a));

const core: Builtin[] = [
  {
    name: 'point', minArgs: 1, maxArgs: 3, signature: 'point(x, y[, z])', doc: 'A point. Add `draggable` to move it with the mouse.', category: 'objects',
    apply: (args) => (args.length === 1 && args[0]?.kind === 'vector' ? point(expectVector(args[0])) : args.length === 1 && args[0]?.kind === 'point' ? args[0] : point(nums(args))),
  },
  {
    name: 'vector', minArgs: 1, maxArgs: 3, signature: 'vector(x, y[, z])', doc: 'A vector ⟨x, y⟩.', category: 'objects',
    apply: (args) => (args.length === 1 ? vector(expectVector(args[0])) : vector(nums(args))),
  },
  {
    name: 'slider', minArgs: 2, maxArgs: 4, signature: 'slider(min, max[, value[, step]])', doc: 'A number controlled by a slider.', category: 'objects',
    apply: (args) => {
      const [min, max] = nums(args.slice(0, 2));
      const step = args[3] ? expectNumber(args[3]) : undefined;
      const def = Math.min(max, Math.max(min, 1));
      const value = args[2] ? expectNumber(args[2]) : def;
      return scalar(value, { slider: { min, max, step } });
    },
  },
  {
    name: 'normalize', minArgs: 1, maxArgs: 1, prefix: true, signature: 'normalize(v)', doc: 'Unit vector in the direction of v.', category: 'vectors',
    apply: ([v]) => {
      const c = expectVector(v);
      if (norm(c) === 0) throw new EvalError('Cannot normalize the zero vector');
      return vector(normV(c), (v as VectorValue).anchor, { role: v?.role });
    },
  },
  { name: 'norm', minArgs: 1, maxArgs: 1, signature: 'norm(v)', doc: 'Length ‖v‖.', category: 'vectors', apply: ([v]) => scalar(norm(expectVector(v))) },
  { name: 'length', minArgs: 1, maxArgs: 1, signature: 'length(v)', doc: 'Length ‖v‖.', category: 'vectors', apply: ([v]) => scalar(norm(expectVector(v))) },
  { name: 'dot', minArgs: 2, maxArgs: 2, signature: 'dot(u, v)', doc: 'Dot product u · v.', category: 'vectors', apply: ([a, b]) => scalar(dot(expectVector(a), expectVector(b))) },
  { name: 'cross', minArgs: 2, maxArgs: 2, signature: 'cross(u, v)', doc: 'Cross product u × v.', category: 'vectors', apply: ([a, b]) => vector(cross(expectVector(a), expectVector(b))) },
  { name: 'det', minArgs: 1, maxArgs: 1, signature: 'det(A)', doc: 'Determinant.', category: 'matrices', apply: ([m]) => scalar(det(expectMatrix(m))) },
  { name: 'transpose', minArgs: 1, maxArgs: 1, signature: 'transpose(A)', doc: 'Transpose Aᵀ.', category: 'matrices', apply: ([m]) => matrixV(transpose(expectMatrix(m))) },
  {
    name: 'eigenvalues', minArgs: 1, maxArgs: 1, signature: 'eigenvalues(A)', doc: 'Eigenvalues of a symmetric matrix.', category: 'matrices',
    apply: ([m]) => ({ kind: 'list', items: symmetricEigen(expectMatrix(m)).map((p) => scalar(p.value)) }),
  },
  {
    name: 'eigenvectors', minArgs: 1, maxArgs: 1, signature: 'eigenvectors(A)', doc: 'Unit eigenvectors of a symmetric matrix.', category: 'matrices',
    apply: ([m]) => ({ kind: 'list', items: symmetricEigen(expectMatrix(m)).map((p) => vector(p.vector)) }),
  },
];

let installed = false;
export function installCoreBuiltins() {
  if (installed) return;
  installed = true;
  core.forEach(registerBuiltin);
}
