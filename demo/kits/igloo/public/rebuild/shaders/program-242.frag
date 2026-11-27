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
#define OPAQUE

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


                    #define outPos pc_fragColor
                    uniform sampler2D tTexture1;

                    layout(location = 1) out highp vec4 outVel;
                    uniform sampler2D tTexture2;

                    uniform mat4 uProjMatrix;
                    uniform mat4 uViewMatrix;
                    uniform mat4 uModelMatrix;
                    uniform sampler2D tVel;

                    varying vec2 vUv;

                    uniform Global{vec2 resolution;vec2 resolutionUI;float aspect;float time;float dtRatio;};
                    float treadmill(float p,float margin){float n=fract((p+margin)/(2.0*margin));return n*2.0*margin-margin;}vec2 treadmill(vec2 p,vec2 margin){vec2 n=fract((p+margin)/(2.0*margin));return n*2.0*margin-margin;}vec3 treadmill(vec3 p,vec3 margin){vec3 n=fract((p+margin)/(2.0*margin));return n*2.0*margin-margin;}vec4 treadmill(vec4 p,vec4 margin){vec4 n=fract((p+margin)/(2.0*margin));return n*2.0*margin-margin;}

                    void main() {
                        ivec2 uv = ivec2(gl_FragCoord.xy);
                        vec4 currentPos = texelFetch(tTexture1, uv, 0);
                        vec4 currentVel = texelFetch(tTexture2, uv, 0);

                        // add some velocity so leaves fall
                        currentVel.x += (sin(time * 0.2 + currentPos.w * 15.6547) + sign(currentPos.w - 0.5) * 2.0) * 0.00075 * dtRatio;
                        currentVel.x += 0.0025 * dtRatio;
                        currentVel.y -= 0.004 * mix(0.5, 0.8, fract(currentPos.w * 31.342)) * dtRatio;
                        currentVel.z += 0.0025 * dtRatio;

                        // add fluid sim interaction
                        // const float pushForce = 0.0035;
                        // vec4 wPos = uModelMatrix * vec4(currentPos.xyz, 1.0);
                        // vec4 vPos = uViewMatrix * wPos;
                        // vec4 posProjected = uProjMatrix * vPos;
                        // vec2 uvScreen = (posProjected.xy / posProjected.w + 1.0) * 0.5;
                        // vec2 vel = texture2D(tVel, uvScreen).xy;

                        /*
                        // since the camera is on -z, there's no need to calculate up and right vectors of camera
                        vec3 up = vec3(uViewMatrix[0][1], uViewMatrix[1][1], uViewMatrix[2][1]);
                        vec3 right = vec3(uViewMatrix[0][0], uViewMatrix[1][0], uViewMatrix[2][0]);
                        vec3 disp = (right * vel.x + up * vel.y);
                        */
                        // currentVel.xy += vel * pushForce * dtRatio;

                        // store rotation in alpha
                        // currentVel.a += length(vel) * pushForce * 1.75 * dtRatio;

                        // friction
                        currentVel.xyz *= exp2(log2(0.9) * dtRatio);

                        // add vel to position
                        currentPos.xyz += currentVel.xyz * dtRatio;

                        // treadmill position
                        currentPos.xyz = treadmill(currentPos.xyz, vec3(25.0, 10.0, 25.0));

                        outVel = currentVel;
                        outPos = currentPos;
                    }
                