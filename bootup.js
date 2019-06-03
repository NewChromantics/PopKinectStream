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

var WebsocketServer = null;

var Params = {};
Params.DepthMin = 10;
Params.DepthMax = 1000;

Math.clamp = function(min, max,Value)
{
	return Math.min( Math.max(Value, min), max);
}

Math.lerp = function(min, max, Time)
{
	return min + ( (max-min) * Time );
}

Math.range = function(Min,Max,Value)
{
	return (Value-Min) / (Max-Min);
}

Math.rangeClamped = function(Min,Max,Value)
{
	return Math.clamp( 0, 1, Math.range( Min, Max, Value ) );
}



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

function GetKinect8Bit(Depth16Image)
{
	//Pop.Debug(Depth16Image.GetFormat(),Depth16Image.GetWidth(),Depth16Image.GeHeight());
	if ( Depth16Image.GetFormat() != 'KinectDepth' )
		throw "Expected kinect depth, but format is " + Depth16Image.GetFormat();

	const w = Depth16Image.GetWidth();
	const h = Depth16Image.GetHeight();
	const Depth16 = Depth16Image.GetPixelBuffer();
	const Depth8 = new Uint8Array( w*h );

	for ( let i=0;	i<Depth16.length;	i++ )
	{
		let Depth = Depth16[i];

		//	normalise
		let Depthf = Math.rangeClamped( Params.DepthMin, Params.DepthMax, Depth );
		//Pop.Debug(Depthf);
		Depth = Math.floor( Depthf * 255 );

		Depth8[i] = Depth;
	}

	const Depth8Image = new Pop.Image();
	Depth8Image.WritePixels( w, h, Depth8, 'Greyscale' );
	return Depth8Image;
}

function BroadcastH264Packet(Packet)
{
	//	need to buffer up packets here so SPS & PPS get sent
	//	we should grab an initial set of header packets for new connections
	if ( !WebsocketServer )
		return;

	let SendToPeer = function(Peer)
	{
		WebsocketServer.Send( Peer, Packet );
	}
	let Peers = WebsocketServer.GetPeers();
	Peers.forEach( SendToPeer );
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
			await Pop.Yield(0);
			const fb = FrameBuffer;
			const Stream = 0;
			const Latest = true;
			const NextFrame = await CameraSource.GetNextFrame( FrameBuffer, Stream, Latest );
			if ( !NextFrame )
				continue;
			
			InputCounter.Add(1);

			InputImage = NextFrame;
			//	convert from kinect to something we can send			
			let YuvFrame = GetKinect8Bit(NextFrame);
			InputImage = YuvFrame;
			Encoder.Encode( YuvFrame, FrameTime++ );
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





function CreateParamsWindow(Params,OnAnyChanged)
{
	OnAnyChanged = OnAnyChanged || function(){};
	
	let WindowRect = [20,20,100,400];
	let ControlTop = 10;
	const ControlLeft = 10;
	const ControlWidth = 400;
	const ControlHeight = 20;
	const ControlSpacing = 10;

	let Window = new Pop.Gui.Window("Params");
	Window.Controls = [];
	Window.Labels = [];

	let AddSlider = function(Name,Min,Max,CleanValue)
	{
		if ( !CleanValue )
			CleanValue = function(v)	{	return v;	}
			
		let Label = new Pop.Gui.Label( Window, [ControlLeft,ControlTop,ControlWidth,ControlHeight] );
		ControlTop += ControlHeight;
		
		let Control;
		if ( typeof Params[Name] === 'boolean' )
		{
			Control = new Pop.Gui.TickBox( Window, [ControlLeft,ControlTop,ControlWidth,ControlHeight] );
			Control.SetValue( Params[Name] );
			
			Control.OnChanged = function(Value)
			{
				Value = CleanValue(Value);
				Params[Name] = Value;
				Label.SetValue( Name + ": " + Value );
				OnAnyChanged(Params);
			}
			
			//	init label
			Control.OnChanged( Params[Name] );
		}
		else
		{
			let Slider = new Pop.Gui.Slider( Window, [ControlLeft,ControlTop,ControlWidth,ControlHeight] );
			Slider.SetMinMax( 0, 1000 );
			let Valuef = Math.range( Min, Max, Params[Name] );
			let Valuek = Valuef * 1000;
			Slider.SetValue( Valuek );
			
			Slider.OnChanged = function(Valuek)
			{
				let Valuef = Valuek/1000;
				let Value = Math.lerp( Min, Max, Valuef );
				Value = CleanValue(Value);
				Params[Name] = Value;
				Label.SetValue( Name + ": " + Value );
				
				OnAnyChanged(Params);
			}
			
			//	init label
			Slider.OnChanged( Valuek );
			Control = Slider;
		}
		
		ControlTop += ControlHeight;
		ControlTop += ControlSpacing;
		
		
		//	save objects
		Window.Controls[Name] = Control;
		Window.Labels[Name] = Label;
	}
	
	
	AddSlider('DepthMin',0,5000,Math.floor);
	AddSlider('DepthMax',0,5000,Math.floor);
		
	return Window;
}

function SaveParams(Params)
{
	//
}

//	make params editor
const ParamsEditor = CreateParamsWindow(Params,SaveParams);

//	gr: this shoulod be async in case we have trouble creating ports
function CreateWebsocketServer(Ports)
{
	let Try = 0;
	while(true)
	{
		let Port = Ports[Try%Ports.length];
		Try++;
		try
		{
			let Server = new Pop.Websocket.Server(Port);
			Pop.Debug("Created websocket server at " + JSON.stringify(Server.GetAddress()) );
			return Server;
		}
		catch(Exception)
		{
			Pop.Debug("Creating websocket on " + Port + " failed; " + Exception);
			//	todo: sleep here!
		}
	}
}

const BroadcastServer = new UdpBroadcastServer(9999);
const WebsocketPorts = [8888,8887,8886,8885,8884,8883];
WebsocketServer = CreateWebsocketServer(WebsocketPorts);

function GetBroadcastMessage()
{
	let AddressObject = {};
	AddressObject.Addresses = [];
	let AddrInfo = WebsocketServer.GetAddress();
	AddrInfo.forEach( Addr => AddressObject.Addresses.push( Addr.Address ) );
	let MessageOut = JSON.stringify(AddressObject);
	return MessageOut;
}
Pop.Debug(GetBroadcastMessage());

BroadcastServer.OnMessage = function(MessageIn,Sender)
{
	let MessageOut = GetBroadcastMessage();
	BroadcastServer.Send( Sender, MessageOut );
}

