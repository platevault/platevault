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

function isInsideSvg(node) {
  let ancestor = node.parent?.parent;
  const ownElement = ancestor;
  while (ancestor) {
    if (
      ancestor.type === 'JSXElement' &&
      ancestor.openingElement.name.type === 'JSXIdentifier'
    ) {
      const name = ancestor.openingElement.name.name;
      if (name === 'foreignObject') return ancestor === ownElement;
      if (name === 'svg' || (/^[a-z]/.test(name) && SVG_ELEMENTS.has(name.toLowerCase()))) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
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
    case 'ConditionalExpression':
      reportRawColorsInExpression(expression.consequent, report);
      reportRawColorsInExpression(expression.alternate, report);
      return;
    case 'LogicalExpression':
      reportRawColorsInExpression(expression.left, report);
      reportRawColorsInExpression(expression.right, report);
      return;
    case 'TemplateLiteral':
      let accumulatedText = '';
      for (let index = 0; index < expression.quasis.length; index += 1) {
        const quasi = expression.quasis[index];
        const text = quasi.value.cooked ?? quasi.value.raw;
        accumulatedText += text;
        if (
          isRawColor(text) ||
          (index < expression.expressions.length &&
            !/url\([^)]*$/i.test(accumulatedText) &&
            /(?:#|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()\s*$/i.test(accumulatedText))
        ) {
          report();
        }
        if (index < expression.expressions.length) accumulatedText += ' '; // Keep substitutions from closing url().
      }
      for (let index = 0; index < expression.expressions.length; index += 1) {
        const priorText = expression.quasis.slice(0, index + 1).map((part) => part.value.cooked ?? part.value.raw).join(' ');
        if (!/url\([^)]*$/i.test(priorText)) {
          reportRawColorsInExpression(expression.expressions[index], report);
        }
      }
      return;
    case 'ChainExpression':
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TypeCastExpression':
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
        if (
          typeof name !== 'string' ||
          !PRESENTATION_ATTRIBUTES.has(name) ||
          !isInsideSvg(node)
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
