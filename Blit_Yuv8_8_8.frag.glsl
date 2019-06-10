precision highp float;
varying vec2 uv;

uniform sampler2D Yuv_8_8_8_Texture;


float Range(float Min,float Max,float Value)
{
	return (Value-Min) / (Max-Min);
}

const float ChromaVRed = 1.5958;
const float ChromaUGreen = -0.39173;
const float ChromaVGreen = -0.81290;
const float ChromaUBlue = 2.017;

float3 LumaChromaToRgb(float Luma,float2 Chroma)
{
	//	0..1 to -0.5..0.5
	Luma = mix( 16.0/255.0, 253.0/255.0, Luma );
	Chroma -= 0.5;
	
	float3 Rgb;
	Rgb.x = Luma + (ChromaVRed * Chroma.y);
	Rgb.y = Luma + (ChromaUGreen * Chroma.x) + (ChromaVGreen * Chroma.y);
	Rgb.z = Luma + (ChromaUBlue * Chroma.x);
	
	Rgb = max( float3(0,0,0), Rgb );
	Rgb = min( float3(1,1,1), Rgb );
	
	return Rgb;
}

float2 GetUvHalf(float2 uv,float Third)
{
	//float Top = Third / 2;
	//float Bottom = (Third+1) / 2;
	float Top = 0;
	float Bottom = 1;
	uv.y = mix( Top, Bottom, uv.y );
	return uv;
}

float2 GetUvQuarter(float2 uv,float Third)
{
	float Top = Third / 4;
	float Bottom = (Third+1) / 4;
	uv.y = mix( Top, Bottom, uv.y );
	return uv;
}

void main()
{
	float2 Luma_uv = GetUvHalf( uv, 0 );
	float2 ChromaU_uv = GetUvQuarter( uv, 2 );
	float2 ChromaV_uv = GetUvQuarter( uv, 3 );
	
	float Luma = texture2D( Yuv_8_8_8_Texture, Luma_uv ).x;
	float ChromaU = texture2D( Yuv_8_8_8_Texture, ChromaU_uv ).x;
	float ChromaV = texture2D( Yuv_8_8_8_Texture, ChromaV_uv ).x;

	//	gr: because of the size/shape of the format atm only the luma gets uploaded
	ChromaU = 0.5;
	ChromaV = 0.5;

	float3 Rgb = LumaChromaToRgb( Luma, float2(ChromaU,ChromaV) );
	
	gl_FragColor = float4( Rgb, 1 );
}


