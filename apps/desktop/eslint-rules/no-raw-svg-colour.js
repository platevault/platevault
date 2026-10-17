// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

const PRESENTATION_ATTRIBUTES = new Set([
  'fill',
  'stroke',
  'stop-color',
  'stopColor',
  'flood-color',
  'floodColor',
  'lighting-color',
  'lightingColor',
  'color',
]);

const NAMED_COLORS = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' ',
  ),
);

const SYSTEM_COLORS = new Set(
  'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext activeborder activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight threedlightshadow threedshadow window windowframe windowtext'.split(
    ' ',
  ),
);

const COLOR_FUNCTION =
  /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\s*\(/i;
const HEX_COLOR = /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const ALLOWED_WORDS = new Set(['currentcolor', 'none', 'inherit', 'transparent']);

function isRawColor(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/url\([^)]*\)/gi, ' ')
    .replace(/var\(\s*--[a-z0-9_-]+\s*\)/gi, ' ');
  if (!normalized) return false;
  if (HEX_COLOR.test(normalized) || COLOR_FUNCTION.test(normalized)) return true;

  const words = normalized.match(/(?<![a-z0-9_-])[a-z][a-z0-9-]*(?![a-z0-9_-])/g) ?? [];
  return words.some(
    (word) =>
      !ALLOWED_WORDS.has(word) &&
      (NAMED_COLORS.has(word) || SYSTEM_COLORS.has(word)),
  );
}

const SVG_ELEMENTS = new Set(
  'circle ellipse image line path polygon polyline rect g text tspan textPath use symbol switch foreignObject view marker pattern mask clipPath defs stop linearGradient radialGradient filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence'.toLowerCase().split(
    ' ',
  ),
);

function isSvgPresentationElement(node) {
  const element = node.parent?.parent;
  if (
    element?.type !== 'JSXElement' ||
    element.openingElement.name.type !== 'JSXIdentifier'
  ) {
    return false;
  }

  const isIntrinsic = (name) => /^[a-z]/.test(name);
  const ownName = element.openingElement.name.name;
  if (!isIntrinsic(ownName)) return false;
  let ancestor = element.parent;
  if (ownName.toLowerCase() === 'svg') return true;
  while (ancestor) {
    if (ancestor.type === 'JSXExpressionContainer') {
      ancestor = ancestor.parent;
      continue;
    }
    if (ancestor.type === 'JSXElement') {
      const ancestorName = ancestor.openingElement.name;
      if (ancestorName.type === 'JSXIdentifier' && /^[A-Z]/.test(ancestorName.name)) {
        ancestor = ancestor.parent;
        continue;
      }
      if (ancestorName.type !== 'JSXIdentifier' || !isIntrinsic(ancestorName.name)) {
        ancestor = ancestor.parent;
        continue;
      }
      const normalizedAncestorName = ancestorName.name.toLowerCase();
      if (normalizedAncestorName === 'foreignobject') return false;
      if (normalizedAncestorName === 'svg') return true;
      if (SVG_ELEMENTS.has(normalizedAncestorName)) return true;
    }
    ancestor = ancestor.parent;
  }

  return ownName.toLowerCase() === 'svg' || SVG_ELEMENTS.has(ownName.toLowerCase());
}
function findUrlClose(value) {
  let nestedParens = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') nestedParens += 1;
    else if (value[index] === ')') {
      if (nestedParens === 0) return index;
      nestedParens -= 1;
    }
  }
  return -1;
}
function getStaticString(expression) {
  if ((expression.type === 'Literal' || expression.type === 'StringLiteral') && typeof expression.value === 'string') {
    return expression.value;
  }
  if (
    expression.type === 'ChainExpression' || expression.type === 'ParenthesizedExpression' ||
    expression.type === 'TSAsExpression' || expression.type === 'TSSatisfiesExpression' ||
    expression.type === 'TSNonNullExpression' || expression.type === 'TypeCastExpression'
  ) return getStaticString(expression.expression);
  if (expression.type === 'TemplateLiteral') {
    let value = expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw ?? '';
    for (let index = 0; index < expression.expressions.length; index += 1) {
      const part = getStaticString(expression.expressions[index]);
      if (part === null) return null;
      value += part + (expression.quasis[index + 1]?.value.cooked ?? expression.quasis[index + 1]?.value.raw ?? '');
    }
    return value;
  }
  return null;
}

function collectStringLiterals(expression, values) {
  const staticValue = getStaticString(expression);
  if (staticValue !== null) {
    values.push(staticValue);
    return;
  } else if (expression.type === 'LogicalExpression') {
    if (expression.operator === '&&') {
      collectStringLiterals(expression.right, values);
    } else if (expression.operator === '||' || expression.operator === '??') {
      collectStringLiterals(expression.left, values);
      collectStringLiterals(expression.right, values);
    }
  } else if (expression.type === 'ConditionalExpression') {
    collectStringLiterals(expression.consequent, values);
    collectStringLiterals(expression.alternate, values);
  } else if (expression.type === 'SequenceExpression') {
    collectStringLiterals(expression.expressions.at(-1), values);
  }
}
function isAllowedPaintExpression(expression) {
  if (expression.type === 'Literal' || expression.type === 'StringLiteral') {
    return typeof expression.value === 'string' && !isRawColor(expression.value);
  }
  if (expression.type === 'LogicalExpression') {
    return expression.operator === '&&'
      ? isAllowedPaintExpression(expression.right)
      : expression.operator === '||' || expression.operator === '??'
        ? isAllowedPaintExpression(expression.left) && isAllowedPaintExpression(expression.right)
        : false;
  }
  if (expression.type === 'ConditionalExpression') {
    return isAllowedPaintExpression(expression.consequent) && isAllowedPaintExpression(expression.alternate);
  }
  if (expression.type === 'SequenceExpression') return isAllowedPaintExpression(expression.expressions.at(-1));
  return false;
}


function reportRawColorsInExpression(expression, report) {
  if (
    (expression.type === 'Literal' || expression.type === 'StringLiteral') &&
    typeof expression.value === 'string'
  ) {
    if (isRawColor(expression.value)) report();
    return;
  }

  switch (expression.type) {
    case 'SequenceExpression':
      reportRawColorsInExpression(expression.expressions.at(-1), report);
      return;
    case 'ConditionalExpression':
      reportRawColorsInExpression(expression.consequent, report);
      reportRawColorsInExpression(expression.alternate, report);
      return;
    case 'LogicalExpression':
      if (expression.operator === '&&') {
        reportRawColorsInExpression(expression.right, report);
      } else if (expression.operator === '||' || expression.operator === '??') {
        reportRawColorsInExpression(expression.left, report);
        reportRawColorsInExpression(expression.right, report);
      }
      return;
    case 'TemplateLiteral':
      const quasis = expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
      const staticParts = expression.expressions.map((part) => getStaticString(part));
      const staticText = quasis.reduce(
        (text, quasi, index) => text + quasi + (staticParts[index] ?? ''),
        '',
      );
      if (staticParts.every((part) => part !== null)) {
        if (isRawColor(staticText)) report();
        return;
      }
      let mode = 'normal';
      const opener = /url\s*\(|var\s*\(|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/ig;
      const scanText = (text) => {
        let cursor = 0;
        while (cursor < text.length) {
          if (mode === 'url') {
            let nestedParens = 0;
            let close = -1;
            for (let index = cursor; index < text.length; index += 1) {
              if (text[index] === '(') nestedParens += 1;
              else if (text[index] === ')') {
                if (nestedParens === 0) { close = index; break; }
                nestedParens -= 1;
              }
            }
            if (close < 0) return;
            cursor = close + 1;
            mode = 'normal';
            continue;
          }
          if (mode === 'color-function') {
            const close = text.indexOf(')', cursor);
            if (close < 0) return;
            cursor = close + 1;
            mode = 'normal';
            continue;
          }
          if (mode === 'dynamic-var-argument' || mode === 'variable-name') {
            let depth = 0;
            let boundary = -1;
            let delimiter = '';
            for (let index = cursor; index < text.length; index += 1) {
              if (text[index] === '(') depth += 1;
              else if (text[index] === ')') {
                if (depth === 0) { boundary = index - cursor; delimiter = ')'; break; }
                depth -= 1;
              } else if (text[index] === ',' && depth === 0) {
                boundary = index - cursor; delimiter = ','; break;
              }
            }
            if (boundary < 0) return;
            const boundaryIndex = cursor + boundary;
            if (delimiter === ',') {
              mode = 'normal';
              const fallback = text.slice(boundaryIndex + 1);
              scanText(fallback);
              cursor = text.length;
            } else {
              cursor = boundaryIndex + 1;
              mode = 'normal';
            }
            continue;
          }

          opener.lastIndex = cursor;
          const match = opener.exec(text);
          const end = match ? match.index : text.length;
          if (isRawColor(text.slice(cursor, end))) report();
          if (!match) return;
          const functionName = match[0].trim().slice(0, -1).toLowerCase();
          cursor = opener.lastIndex;
          if (functionName === 'url') {
            mode = 'url';
          } else if (functionName === 'var') {
            const nameStart = text.slice(cursor).search(/\S/);
            if (nameStart >= 0 && text.slice(cursor + nameStart).startsWith('--')) {
              cursor += nameStart + 2;
              mode = 'variable-name';
            } else {
              mode = 'dynamic-var-argument';
            }
          } else {
            report();
            mode = 'color-function';
          }
        }
      };

      for (let index = 0; index < expression.quasis.length; index += 1) {
        const quasi = quasis[index] ?? '';
        scanText(quasi);
        if (index < expression.expressions.length) {
          let interpolationHandled = false;
          if (mode === 'url') {
            interpolationHandled = true;
            const values = [];
            collectStringLiterals(expression.expressions[index], values);
            if (values.some((value) => findUrlClose(value) >= 0)) {
              mode = 'normal';
              for (const value of values) {
                const close = findUrlClose(value);
                if (close >= 0 && value.slice(close + 1)) scanText(value.slice(close + 1));
              }
            }
          }
          if (!interpolationHandled && (mode === 'variable-name' || mode === 'dynamic-var-argument')) {
            const values = [];
            collectStringLiterals(expression.expressions[index], values);
            interpolationHandled = true;
            const nestedUrlFallback = values.some((value) => {
              const comma = value.indexOf(',');
              return comma >= 0 && /url\s*\(/i.test(value.slice(comma + 1));
            });
            if (values.some((value) => value.includes(','))) {
              mode = 'normal';
              for (const value of values) {
                const comma = value.indexOf(',');
                if (comma >= 0) {
                  const before = value.slice(0, comma + 1);
                  const after = value.slice(comma + 1);
                  if (!nestedUrlFallback) scanText(before);
                  if (after) scanText(after);
                }
              }
            }
          }
          if (mode === 'normal' && expression.expressions[index].type === 'LogicalExpression' && isAllowedPaintExpression(expression.expressions[index])) {
            interpolationHandled = true;
          }
          const skipInterpolation = interpolationHandled || mode !== 'normal';
          if (mode === 'normal' && /#\s*$/.test(quasi)) report();
          if (mode === 'normal' && /#[0-9a-f]+$/i.test(quasi)) report();
          if (!skipInterpolation) {
            reportRawColorsInExpression(expression.expressions[index], report);
            scanText('x');
          }
        }
      }
      return;
    case 'ChainExpression':
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TypeCastExpression':
    case 'TSNonNullExpression':
      reportRawColorsInExpression(expression.expression, report);
      return;
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw colours in SVG presentation attributes; use theme variables.',
    },
    schema: [],
    messages: {
      rawColor:
        'Raw colour in SVG presentation attribute "{{name}}". Use a theme variable.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const name = node.name.name;
        const elementName = node.parent?.name;
        if (
          typeof name !== 'string' ||
          !PRESENTATION_ATTRIBUTES.has(name) ||
          elementName?.type !== 'JSXIdentifier' ||
          !/^[a-z]/.test(elementName.name) ||
          !isSvgPresentationElement(node)
        ) {
          return;
        }

        if (!node.value) return;
        const report = () =>
          context.report({ node, messageId: 'rawColor', data: { name } });

        if (node.value.type === 'Literal' && typeof node.value.value === 'string') {
          if (isRawColor(node.value.value)) report();
          return;
        }

        if (node.value.type === 'JSXExpressionContainer') {
          reportRawColorsInExpression(node.value.expression, report);
        }
      },
    };
  },
};

export default {
  rules: {
    'no-raw-svg-colour': rule,
  },
};
