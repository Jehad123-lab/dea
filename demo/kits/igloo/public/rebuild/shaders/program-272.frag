#version 300 es
#define varying in
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define gl_FragDepthEXT gl_FragDepth
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DProjLodEXT textureProjLod
#define textureCubeLodEXT textureLod
#define texture2DGradEXT textureGrad
#define texture2DProjGradEXT textureProjGrad
#define textureCubeGradEXT textureGrad
precision highp float;
	precision highp int;
	precision highp sampler2D;
	precision highp samplerCube;
	precision highp sampler3D;
	precision highp sampler2DArray;
	precision highp sampler2DShadow;
	precision highp samplerCubeShadow;
	precision highp sampler2DArrayShadow;
	precision highp isampler2D;
	precision highp isampler3D;
	precision highp isamplerCube;
	precision highp isampler2DArray;
	precision highp usampler2D;
	precision highp usampler3D;
	precision highp usamplerCube;
	precision highp usampler2DArray;
	
#define HIGH_PRECISION
#define SHADER_TYPE ShaderMaterial
#define SHADER_NAME 
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;

const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 LinearToLinear( in vec4 value ) {
	return value;
}
vec4 LinearTosRGB( in vec4 value ) {
	return sRGBTransferOETF( value );
}
vec4 linearToOutputTexel( vec4 value ) { return ( LinearTransferOETF( value ) ); }


                //- edit
                uniform Global{vec2 resolution;vec2 resolutionUI;float aspect;float time;float dtRatio;};
                float _linstep(float begin,float end,float t){return clamp((t-begin)/(end-begin),0.0,1.0);}float _pl(vec2 _input,vec2 start,vec2 end,float margin,float progress){vec2 v=end-start;float dist=length(v);vec2 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float _pl(vec3 _input,vec3 start,vec3 end,float margin,float progress){vec3 v=end-start;float dist=length(v);vec3 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float falloff(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return _linstep(p+m,p,_input);}float falloffsmooth(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return smoothstep(p+m,p,_input);}float falloff(vec2 _input,vec2 start,vec2 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec2 _input,vec2 start,vec2 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloff(vec3 _input,vec3 start,vec3 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec3 _input,vec3 start,vec3 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}

                varying vec2 vUv;
                varying vec3 vPos;
                varying vec3 vWorldPos;
                varying vec3 vMouseGlow;
                varying vec3 vNormal;

                uniform sampler2D tMap;
                uniform sampler2D tWind;
                uniform sampler2D tGroundGlow;
                uniform sampler2D tTriangles;
                uniform sampler2D tNoise;

                uniform vec3 uMousePos;
                uniform float uProgress;
                uniform float uProgress2;
                uniform float uTriangleAlpha;
                uniform float uAlpha;

                void main() {
                    float alpha = 1.0;

                    vec3 terrainColor = texture2D(tMap, vUv).rgb;

                    // ground glow based on mouse position
                    vec3 glow = texture2D(tGroundGlow, vUv).rgb;
                    float glowStrength = (sin(vPos.x - time * 1.0 + 3.2) * 0.5 + 0.5);
                    terrainColor += glow * glowStrength * terrainColor.r;
                    terrainColor += vMouseGlow * terrainColor.r;

                    // wind
                    float t = time;
                    float radialGrad = 1.0 - smoothstep(1.0, 0.8, length(vPos) * 0.2);
                    float verticalGrad = (1.0 - clamp(vPos.y * 0.3 + 1.1, 0.0, 1.0));
                    float wind = texture2D(tWind, vWorldPos.xz * 0.15 + vUv * 0.1 + vec2(-t * 0.15, -t * 0.15)).r;
                    wind *= texture2D(tWind, vWorldPos.xz * 0.17 + vUv * 0.1 + vec2(-t * 0.15, -t * 0.15)).r;
                    wind *= verticalGrad;
                    terrainColor = mix(terrainColor, vec3(1.0), wind * 4.0);

                    vec3 color = terrainColor;

                    // intro animation
                    if (uProgress2 < 1.0) {
                        // reduce alpha to zero so we can composite layers onto it
                        alpha *= 0.0;

                        // create input textures and values
                        float noise = texture2D(tNoise, vWorldPos.xz * 0.07).r;
                        float triangles = texture2D(tTriangles, vWorldPos.xz * 0.25).r;
                        vec3 blue = vec3(0.3, 0.45, 1.0);
                        float inputGradient = length(vWorldPos.xz);
                        inputGradient += noise * 3.5;

                        // terrain layer
                        vec3 terrainShockwaveColor = vec3(0.0);
                        float terrainShockwaveAlpha = 0.0;
                        float terrainFalloff = 1.0 - falloffsmooth(inputGradient, 0.0, 32.0, 8.0, uProgress2);
                        float terrainFalloff2 = 1.0 - falloffsmooth(inputGradient, 0.0, 32.0, 3.0, uProgress2);
                        terrainShockwaveColor += terrainFalloff * triangles * blue * 3.0;
                        terrainShockwaveColor += terrainFalloff2 * blue;
                        terrainShockwaveAlpha += falloff(inputGradient, -0.1, 31.9, 0.1, uProgress2);

                        // triangle layer
                        vec3 triangleShockwaveColor = vec3(0.0);
                        float triangleShockwaveAlpha = 0.0;
                        float triangleFalloff = 1.0 - falloffsmooth(inputGradient, 0.0, 32.0, 10.0, uProgress);
                        triangleShockwaveColor += blue;
                        triangleShockwaveAlpha += falloff(inputGradient, 1.0, 33.0, 0.1, uProgress);
                        triangleShockwaveAlpha *= triangleFalloff;
                        triangleShockwaveAlpha *= triangles;

                        // composite layers
                        color += terrainShockwaveColor;
                        alpha += terrainShockwaveAlpha;

                        color += triangleShockwaveColor * (1.0 - terrainShockwaveAlpha);
                        alpha += triangleShockwaveAlpha * (1.0 - terrainShockwaveAlpha);
                    }

                    // fade at edges
                    alpha *= 1.0 - smoothstep(0.8, 1.0, length(vPos.xz) * 0.1085);

                    // color safety
                    alpha = clamp(alpha, 0.0, 1.0);
                    color = clamp(color, vec3(0.0), vec3(1.0));

                    // global fade
                    alpha *= uAlpha;

                    gl_FragColor = vec4(color, alpha);
                }
            