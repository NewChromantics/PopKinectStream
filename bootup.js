Pop.Include = function(Filename)
{
	const Source = Pop.LoadFileAsString(Filename);
	return Pop.CompileAndRun( Source, Filename );
}


let VertShader = Pop.LoadFileAsString('Quad.vert.glsl');
let BlitFragShader = Pop.LoadFileAsString('Blit.frag.glsl');

Pop.Include('TFrameCounter.js');

Pop.CreateColourTexture = function(Colour4)
{
	let NewTexture = new Pop.Image();
	NewTexture.WritePixels( 1, 1, Colour4 );
	return NewTexture;
}


let InputImage = Pop.CreateColourTexture([255,0,0,255]);
let OutputImage = Pop.CreateColourTexture([0,255,0,255]);
const Encoder = new Pop.Media.H264Encoder();
let BlitShader = null;
let InputCounter = new TFrameCounter("Kinect input");
let EncodeCounter = new TFrameCounter("H264 encodes");
let H264ByteCounter = new TFrameCounter("H264 bytes");
let RenderCounter = new TFrameCounter("Render");


H264ByteCounter.Report = function(CountPerSec)
{
	let KbSec = CountPerSec / 1024;
	Pop.Debug( this.CounterName + " " + KbSec.toFixed(2) + "kb/sec");
}

function Render(RenderTarget)
{
	const ShaderSource = BlitFragShader;
	if ( !BlitShader )
	{
		BlitShader = new Pop.Opengl.Shader( RenderTarget, VertShader, BlitFragShader );
	}
	const FragShader = BlitShader;
		
	const DrawLeft_SetUniforms = function(Shader)
	{
		Shader.SetUniform("VertexRect", [0,0,0.5,1] );
		Shader.SetUniform("Texture", InputImage );
	}
	RenderTarget.DrawQuad( FragShader, DrawLeft_SetUniforms );

	const DrawRight_SetUniforms = function(Shader)
	{
		Shader.SetUniform("VertexRect", [0.5,0,0.5,1] );
		Shader.SetUniform("Texture", OutputImage );
	}
	RenderTarget.DrawQuad( FragShader, DrawRight_SetUniforms );

	RenderCounter.Add(1);
}

function BroadcastH264Packet(Packet)
{
}

async function ProcessEncoding()
{
	const Decoder = new Pop.Media.AvcDecoder();

	//	encode, decode, encode, decode etc
	while ( true )
	{
		const Packet = await Encoder.GetNextPacket();
		if ( !Packet )
			continue;

		EncodeCounter.Add(1);
		H264ByteCounter.Add(Packet.length);
	
		//	send packet over network
		BroadcastH264Packet( Packet );

		//	decode to screen to debug
		const ExtractPlanes = false;
		const Frames = await Decoder.Decode(Packet,ExtractPlanes);
		//Pop.Debug(JSON.stringify(Frames));
		if ( Frames.length == 0 )
			continue;

		//Pop.Debug("Frames",Frames);
		//Pop.Debug(Frames.length);
		const Frame = Frames[0].Planes[0];
		if ( Frame )
		{
			//Pop.Debug("Output frame",Frame.GetFormat());
			OutputImage = Frame;
			//OutputImage.SetFormat('Greyscale');
		}
		
	}
}

async function ProcessKinectFrames(CameraSource)
{
	const FrameBuffer = new Pop.Image();
	let FrameTime = 0;
	//const FrameBuffer = undefined;
	while ( true )
	{
		try
		{
			await Pop.Yield(20);
			const fb = FrameBuffer;
			const Stream = 0;
			const Latest = true;
			const NextFrame = await CameraSource.GetNextFrame( FrameBuffer, Stream, Latest );
			if ( !NextFrame )
				continue;
			
			InputCounter.Add(1);

			//InputImage = NextFrame;
			//	convert from kinect to something we can send			
			let YuvFrame = new Pop.Image();
			YuvFrame.Copy(NextFrame);
			YuvFrame.SetFormat('Greyscale');
			InputImage = YuvFrame;
			Encoder.Encode( YuvFrame, FrameTime++ );
			//this.CameraFrameCounter.Add();
		}
		catch(e)
		{
			//	sometimes OnFrameExtracted gets triggered, but there's no frame? (usually first few on some cameras)
			//	so that gets passed up here. catch it, but make sure we re-request
			if ( e != "No frame packet buffered" )
				Pop.Debug(e);
		}
	}
}

let Kinect = new Pop.Media.Source("Kinect2:Default_Depth");
ProcessKinectFrames(Kinect).then(Pop.Debug).catch(Pop.Debug);
ProcessEncoding().then(Pop.Debug).catch(Pop.Debug);

let Window = new Pop.Opengl.Window("Kinect Stream");
Window.OnRender = Render;
Window.OnMouseMove = function(){};

